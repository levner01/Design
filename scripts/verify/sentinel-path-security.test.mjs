#!/usr/bin/env node
/**
 * Sentinel 路径安全测试（第四次复验 §5.3）。
 *
 * 验证 main 进程的 resolveSmokeSentinelPath 安全约束：
 *   1. 合法临时路径（designwan-smoke-{prefix}/sentinel.json）→ sentinel 写入成功
 *   2. 任意外部路径（/tmp/evil.json）→ sentinel 不写入
 *   3. 路径穿越（designwan-smoke-{prefix}/../../evil.json）→ sentinel 不写入
 *   4. Symlink 逃逸 → sentinel 不写入
 *   5. 未开启 SMOKE_MODE 时完全不启用 sentinel
 */
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync, mkdtempSync, symlinkSync, readFileSync } from 'node:fs';
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
 * 启动 electron 并等待 sentinel 或超时。
 * 返回 sentinel 内容（如果写入）或 null。
 */
function runElectronAndWait(sentinelPath, env, timeoutMs = 8000) {
  rmSync(sentinelPath, { force: true });

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

  return new Promise((resolve) => {
    let done = false;
    let checkSentinel = null;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (checkSentinel) clearInterval(checkSentinel);
      try {
        child.kill('SIGTERM');
        setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {}
        }, 2000);
      } catch {
        // 已退出
      }
      resolve(result);
    };

    const timer = setTimeout(() => {
      let sentinelContent = null;
      if (existsSync(sentinelPath)) {
        try {
          sentinelContent = JSON.parse(readFileSync(sentinelPath, 'utf8'));
        } catch {
          // 损坏
        }
      }
      finish({ timedOut: true, sentinelContent });
    }, timeoutMs);

    child.on('exit', () => {
      let sentinelContent = null;
      if (existsSync(sentinelPath)) {
        try {
          sentinelContent = JSON.parse(readFileSync(sentinelPath, 'utf8'));
        } catch {
          // 损坏
        }
      }
      finish({ exited: true, sentinelContent });
    });

    // 轮询 sentinel
    checkSentinel = setInterval(() => {
      if (existsSync(sentinelPath)) {
        try {
          const content = JSON.parse(readFileSync(sentinelPath, 'utf8'));
          if (content.ok !== undefined) {
            finish({ sentinelContent: content });
          }
        } catch {
          // 文件可能还在写入
        }
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
    const result = await runElectronAndWait(sentinel, {
      DESIGNWAN_SMOKE_MODE: '1',
      DESIGNWAN_SMOKE_SENTINEL: sentinel,
    });
    assert.ok(
      !existsSync(sentinel),
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
    const result = await runElectronAndWait(evilPath, {
      DESIGNWAN_SMOKE_MODE: '1',
      DESIGNWAN_SMOKE_SENTINEL: evilPath,
    });
    assert.ok(
      !existsSync(evilPath),
      `sentinel should NOT be written to path-traversal target, but file exists`,
    );
  } finally {
    rmSync(smokeDir, { force: true, recursive: true });
    rmSync(evilPath, { force: true });
  }
});

// 4. Symlink 逃逸 → sentinel 不写入
test('INVALID: symlink escape → sentinel NOT written', async () => {
  const smokeDir = mkdtempSync(join(tmpdir(), 'designwan-smoke-'));
  const externalFile = join(tmpdir(), `designwan-symlink-target-${Date.now()}.json`);
  const symlinkPath = join(smokeDir, 'sentinel.json');
  try {
    // 创建 symlink 指向外部文件
    symlinkSync(externalFile, symlinkPath);
    const result = await runElectronAndWait(symlinkPath, {
      DESIGNWAN_SMOKE_MODE: '1',
      DESIGNWAN_SMOKE_SENTINEL: symlinkPath,
    });
    // realpath 后的父目录仍是 smokeDir，但 symlink 指向外部文件
    // main 的 realpath 校验会解析 symlink，发现目标不在 designwan-smoke-* 下
    // 或者 wx flag 会因为 symlink 已存在而失败
    assert.ok(
      !existsSync(externalFile),
      `sentinel should NOT be written through symlink escape, but target file exists`,
    );
  } finally {
    rmSync(symlinkPath, { force: true });
    rmSync(externalFile, { force: true });
    rmSync(smokeDir, { force: true, recursive: true });
  }
});

// 5. 未开启 SMOKE_MODE → 完全不启用 sentinel
test('INVALID: no SMOKE_MODE → sentinel NOT written', async () => {
  const smokeDir = mkdtempSync(join(tmpdir(), 'designwan-smoke-'));
  const sentinel = join(smokeDir, 'sentinel.json');
  try {
    const result = await runElectronAndWait(sentinel, {
      // 只给 SENTINEL 不给 MODE
      DESIGNWAN_SMOKE_SENTINEL: sentinel,
    });
    assert.ok(
      !existsSync(sentinel),
      `sentinel should NOT be written when SMOKE_MODE is not enabled`,
    );
  } finally {
    rmSync(smokeDir, { force: true, recursive: true });
  }
});
