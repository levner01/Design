#!/usr/bin/env node
/**
 * Sentinel 路径安全测试（第五次整改 §B）。
 *
 * 修复第四轮验收 §6.2 P1：
 * - runElectronAndWait() 不得无条件删除调用方预置的 Symlink（假绿根因）
 * - Symlink 测试必须证明夹具真实存在，启动前断言 isSymbolicLink === true
 * - 运行后必须断言：外部文件未创建/未修改、Symlink 未被替换为普通文件、App 拒绝
 *
 * 第五次整改 §B 关键修复：
 * - App 端 resolveSmokeSentinelPath 增加 lstatSync 检查，拒绝 symlink 路径
 * - 测试端 readSentinelSafe 用 lstatSync 防 follow symlink 读到外部文件内容
 * - existsSync 会 follow symlink，symlink → 不存在文件时返回 false，
 *   必须用 lstatSync 检查 symlink 本身是否存在
 *
 * 验证 main 进程的 resolveSmokeSentinelPath 安全约束：
 *   1. 合法临时路径（designwan-smoke-{prefix}/sentinel.json）→ sentinel 写入成功
 *   2. 任意外部路径（/tmp/evil.json）→ sentinel 不写入
 *   3. 路径穿越（designwan-smoke-{prefix}/../../evil.json）→ sentinel 不写入
 *   4. Symlink 指向不存在的外部文件 → sentinel 不写入，symlink 保留，外部文件不创建
 *   5. Symlink 指向已存在且有原始内容的外部文件 → sentinel 不写入，内容不被篡改
 *   6. 未开启 SMOKE_MODE 时完全不启用 sentinel
 */
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  rmSync,
  mkdtempSync,
  symlinkSync,
  readFileSync,
  lstatSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const desktopDir = join(root, 'apps/desktop');

function findElectronBinary() {
  const electronPkgDir = join(desktopDir, 'node_modules/electron');
  const pathTxt = join(electronPkgDir, 'path.txt');
  if (!existsSync(pathTxt)) {
    throw new Error(`electron/path.txt not found at ${pathTxt}; run pnpm install first`);
  }
  const relPath = readFileSync(pathTxt, 'utf-8').trim();
  return join(electronPkgDir, 'dist', relPath);
}

const electronBin = findElectronBinary();

/**
 * 安全读取 sentinel：用 lstatSync 而非 existsSync，避免 follow symlink。
 *
 * 假绿根因：existsSync/readFileSync 会 follow symlink，
 * 如果 symlink 指向已存在的外部文件，会读到外部文件内容，
 * 测试误以为 App 写了 sentinel，实际读到的是外部文件原始内容。
 *
 * 正确做法：先用 lstatSync 检查路径本身：
 * - 是 symlink → 返回 null（App 应拒绝 symlink，不读外部内容）
 * - 是普通文件 → 读取内容
 * - 不存在 → 返回 null
 */
function readSentinelSafe(sentinelPath) {
  let stat;
  try {
    stat = lstatSync(sentinelPath);
  } catch {
    // 路径不存在（ENOENT）或其他错误
    return null;
  }
  // 关键：symlink 路径不读取目标内容，避免假绿
  if (stat.isSymbolicLink()) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(sentinelPath, 'utf8'));
  } catch {
    // 文件损坏或正在写入
    return null;
  }
}

/**
 * 检查路径本身是否存在（不 follow symlink）。
 * existsSync 会 follow symlink，symlink → 不存在文件时返回 false，
 * 但 symlink 本身可能仍存在。用 lstatSync 才能准确判断。
 */
function pathExistsNoFollow(p) {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * 启动 electron 并等待 sentinel 或超时。
 *
 * 第五次整改 §B.1-2：
 * - preserveExisting=true 时不删除调用方预置的 Symlink/文件
 * - 调用方需要在启动前自行断言夹具存在
 *
 * 返回 { timedOut?, exited?, sentinelContent? }
 */
function runElectronAndWait(sentinelPath, env, timeoutMs = 8000, opts = {}) {
  const { preserveExisting = false } = opts;

  // 仅在不保留现有文件时清理（避免删除调用方预置的 Symlink 夹具）
  if (!preserveExisting) {
    rmSync(sentinelPath, { force: true });
  }

  const child = spawn(electronBin, ['.', '--no-sandbox'], {
    cwd: desktopDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ELECTRON_DISABLE_GPU: '1',
      ELECTRON_ENABLE_LOGGING: '0',
      ...env,
    },
  });

  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  return new Promise((resolve) => {
    let done = false;
    let checkSentinel = null;
    let forceKillTimer = null;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (checkSentinel) clearInterval(checkSentinel);

      const resolveAfterClose = (exitCode = child.exitCode, signal = child.signalCode) => {
        if (forceKillTimer) clearTimeout(forceKillTimer);
        resolve({ ...result, exitCode, signal, stderr });
      };

      // 等待 close，确保 stdio 已关闭且旧 Electron 不会污染下一用例。
      child.once('close', resolveAfterClose);
      if (child.exitCode !== null || child.signalCode !== null) return;

      try {
        child.kill('SIGTERM');
      } catch {
        resolveAfterClose();
        return;
      }
      forceKillTimer = setTimeout(() => {
        try {
          if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        } catch {
          // 已退出
        }
      }, 2000);
    };

    const timer = setTimeout(() => {
      // 用 readSentinelSafe 而非 existsSync+readFileSync，避免 follow symlink 假绿
      const sentinelContent = readSentinelSafe(sentinelPath);
      finish({ timedOut: true, sentinelContent });
    }, timeoutMs);

    child.on('exit', (exitCode, signal) => {
      const sentinelContent = readSentinelSafe(sentinelPath);
      finish({ exited: true, exitCode, signal, sentinelContent });
    });

    child.on('error', (error) => {
      finish({ spawnError: error.message, sentinelContent: readSentinelSafe(sentinelPath) });
    });

    // 轮询 sentinel（用 readSentinelSafe 防 follow symlink）
    checkSentinel = setInterval(() => {
      const content = readSentinelSafe(sentinelPath);
      if (content !== null && content.ok !== undefined) {
        finish({ sentinelContent: content });
      }
    }, 100);
  });
}

// 1. 合法临时路径 → sentinel 写入成功
test('VALID: sentinel under designwan-smoke-* dir → written', async () => {
  const smokeDir = mkdtempSync(join(tmpdir(), 'designwan-smoke-'));
  const sentinel = join(smokeDir, 'sentinel.json');
  try {
    const result = await runElectronAndWait(sentinel, {
      DESIGNWAN_SMOKE_MODE: '1',
      DESIGNWAN_SMOKE_SENTINEL: sentinel,
    });
    assert.ok(
      result.sentinelContent?.ok === true,
      `expected sentinel.ok=true, got ${JSON.stringify(result.sentinelContent)}`,
    );
  } finally {
    rmSync(smokeDir, { force: true, recursive: true });
  }
});

// 2. 任意外部路径 → sentinel 不写入
test('INVALID: external path → sentinel NOT written', async () => {
  const sentinel = join(tmpdir(), `designwan-evil-${Date.now()}.json`);
  try {
    await runElectronAndWait(sentinel, {
      DESIGNWAN_SMOKE_MODE: '1',
      DESIGNWAN_SMOKE_SENTINEL: sentinel,
    });
    assert.ok(
      !pathExistsNoFollow(sentinel),
      `sentinel should NOT be written to external path, but file exists`,
    );
  } finally {
    rmSync(sentinel, { force: true });
  }
});

// 3. 路径穿越 → sentinel 不写入
test('INVALID: path traversal (..) → sentinel NOT written', async () => {
  const smokeDir = mkdtempSync(join(tmpdir(), 'designwan-smoke-'));
  const evilPath = join(smokeDir, '..', '..', `evil-${Date.now()}.json`);
  try {
    await runElectronAndWait(evilPath, {
      DESIGNWAN_SMOKE_MODE: '1',
      DESIGNWAN_SMOKE_SENTINEL: evilPath,
    });
    assert.ok(
      !pathExistsNoFollow(evilPath),
      `sentinel should NOT be written to path-traversal target, but file exists`,
    );
  } finally {
    rmSync(smokeDir, { force: true, recursive: true });
    rmSync(evilPath, { force: true });
  }
});

// 4. Symlink 指向不存在的外部文件 → sentinel 不写入（第五次整改 §B.4）
test('INVALID: symlink → non-existent external file → NOT written, symlink preserved', async () => {
  const smokeDir = mkdtempSync(join(tmpdir(), 'designwan-smoke-'));
  const externalFile = join(tmpdir(), `designwan-symlink-target-${Date.now()}.json`);
  const symlinkPath = join(smokeDir, 'sentinel.json');
  try {
    // 创建 symlink 指向不存在的外部文件
    symlinkSync(externalFile, symlinkPath);

    // 启动前断言：symlink 真实存在（证明夹具不是虚假的）
    const stat = lstatSync(symlinkPath);
    assert.ok(
      stat.isSymbolicLink(),
      `symlink must exist before run (夹具必须真实存在), got isSymbolicLink=${stat.isSymbolicLink()}`,
    );

    // preserveExisting=true：不删除调用方预置的 Symlink
    const result = await runElectronAndWait(
      symlinkPath,
      {
        DESIGNWAN_SMOKE_MODE: '1',
        DESIGNWAN_SMOKE_SENTINEL: symlinkPath,
      },
      8000,
      { preserveExisting: true },
    );

    // 运行后断言 1：外部文件未被创建
    assert.ok(
      !pathExistsNoFollow(externalFile),
      `sentinel should NOT create external file through symlink, but file exists`,
    );

    // 运行后断言 2：symlink 仍然存在且未被替换为普通文件
    // 注意：不能用 existsSync（会 follow symlink，symlink → 不存在文件时返回 false）
    // 必须用 lstatSync 检查 symlink 本身
    assert.ok(
      pathExistsNoFollow(symlinkPath),
      `symlink path should still exist after run (lstatSync based, not existsSync)`,
    );
    const postStat = lstatSync(symlinkPath);
    assert.ok(
      postStat.isSymbolicLink(),
      `symlink must NOT be replaced with a regular file (got isSymbolicLink=${postStat.isSymbolicLink()})`,
    );

    // 运行后断言 3：App 明确拒绝该路径（sentinelContent 为 null，
    //   因为 App 拒绝 symlink 不写 sentinel，且测试端 readSentinelSafe 不 follow symlink）
    assert.ok(
      result.sentinelContent === null || result.sentinelContent?.ok === false,
      `App should reject symlink sentinel path, got sentinelContent=${JSON.stringify(result.sentinelContent)}`,
    );
    assert.match(
      result.stderr,
      /\[SENTINEL_SYMLINK_REJECTED\]/,
      `App must emit explicit symlink rejection evidence, stderr=${result.stderr}`,
    );
  } finally {
    rmSync(symlinkPath, { force: true });
    rmSync(externalFile, { force: true });
    rmSync(smokeDir, { force: true, recursive: true });
  }
});

// 5. Symlink 指向已存在且有原始内容的外部文件 → sentinel 不写入，内容不被篡改
//    （第五次整改 §B.4：不接受"外部文件不存在所以通过"的未证明断言）
test('INVALID: symlink → existing external file with content → NOT modified, symlink preserved', async () => {
  const smokeDir = mkdtempSync(join(tmpdir(), 'designwan-smoke-'));
  const externalFile = join(tmpdir(), `designwan-symlink-existing-${Date.now()}.json`);
  const originalContent = '{"original":"do-not-overwrite","version":"v1"}';
  const symlinkPath = join(smokeDir, 'sentinel.json');
  try {
    // 创建已存在且有原始内容的外部文件
    writeFileSync(externalFile, originalContent, { encoding: 'utf8' });
    // 创建 symlink 指向已存在的外部文件
    symlinkSync(externalFile, symlinkPath);

    // 启动前断言：symlink 真实存在
    const stat = lstatSync(symlinkPath);
    assert.ok(
      stat.isSymbolicLink(),
      `symlink must exist before run, got isSymbolicLink=${stat.isSymbolicLink()}`,
    );
    // 启动前断言：外部文件有原始内容
    assert.equal(
      readFileSync(externalFile, 'utf8'),
      originalContent,
      `external file must have original content before run`,
    );

    // preserveExisting=true：不删除调用方预置的 Symlink
    const result = await runElectronAndWait(
      symlinkPath,
      {
        DESIGNWAN_SMOKE_MODE: '1',
        DESIGNWAN_SMOKE_SENTINEL: symlinkPath,
      },
      8000,
      { preserveExisting: true },
    );

    // 运行后断言 1：外部文件内容未被修改/篡改
    assert.ok(pathExistsNoFollow(externalFile), `external file should still exist after run`);
    assert.equal(
      readFileSync(externalFile, 'utf8'),
      originalContent,
      `external file content must NOT be modified through symlink escape`,
    );

    // 运行后断言 2：symlink 仍然存在且未被替换为普通文件
    assert.ok(
      pathExistsNoFollow(symlinkPath),
      `symlink path should still exist after run (lstatSync based)`,
    );
    const postStat = lstatSync(symlinkPath);
    assert.ok(
      postStat.isSymbolicLink(),
      `symlink must NOT be replaced with a regular file (got isSymbolicLink=${postStat.isSymbolicLink()})`,
    );

    // 运行后断言 3：App 明确拒绝该路径
    //   - App 端 resolveSmokeSentinelPath 拒绝 symlink，不写 sentinel
    //   - 测试端 readSentinelSafe 不 follow symlink，不读外部文件内容
    //   - 因此 sentinelContent 必须是 null（而不是外部文件原始内容）
    assert.ok(
      result.sentinelContent === null || result.sentinelContent?.ok === false,
      `App should reject symlink sentinel path, got sentinelContent=${JSON.stringify(result.sentinelContent)}`,
    );
    assert.match(
      result.stderr,
      /\[SENTINEL_SYMLINK_REJECTED\]/,
      `App must emit explicit symlink rejection evidence, stderr=${result.stderr}`,
    );
  } finally {
    rmSync(symlinkPath, { force: true });
    rmSync(externalFile, { force: true });
    rmSync(smokeDir, { force: true, recursive: true });
  }
});

// 6. 未开启 SMOKE_MODE → 完全不启用 sentinel
test('INVALID: no SMOKE_MODE → sentinel NOT written', async () => {
  const smokeDir = mkdtempSync(join(tmpdir(), 'designwan-smoke-'));
  const sentinel = join(smokeDir, 'sentinel.json');
  try {
    await runElectronAndWait(sentinel, {
      // 只给 SENTINEL 不给 MODE
      DESIGNWAN_SMOKE_SENTINEL: sentinel,
    });
    assert.ok(
      !pathExistsNoFollow(sentinel),
      `sentinel should NOT be written when SMOKE_MODE is not enabled`,
    );
  } finally {
    rmSync(smokeDir, { force: true, recursive: true });
  }
});
