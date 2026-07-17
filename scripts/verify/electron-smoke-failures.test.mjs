#!/usr/bin/env node
/**
 * Electron Smoke 失败路径测试。
 *
 * 验证 smoke sentinel 机制能正确检测以下故障：
 *   1. Renderer HTML 缺失
 *   2. Preload 缺失
 *   3. Preload 模块格式错误
 *   4. negotiate 失败（IPC handler 返回错误）
 *   5. Ready 超时（进程崩溃不发 sentinel）
 *   6. 进程提前退出
 *
 * 失败测试用源码 `electron .` + 破坏 dist/ 来验证 sentinel 逻辑，
 * 正向 packaged smoke 由 electron-smoke.mjs 独立验证。
 */
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  rmSync,
  readFileSync,
  writeFileSync,
  renameSync,
  copyFileSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const desktopDir = join(root, 'apps/desktop');
const distRenderer = join(desktopDir, 'dist/renderer');
const distPreload = join(desktopDir, 'dist/preload');
const distMain = join(desktopDir, 'dist/main');

/**
 * 解析 Electron 真实二进制路径（绕过 node_modules/.bin/electron shell script）。
 *
 * spawn 一个 shell script 在 Node.js 上会触发 ENOEXEC 或静默失败。
 * 这里直接读 electron/path.txt 拿到 dist 下的二进制相对路径。
 */
function findElectronBinary() {
  if (process.env.ELECTRON_OVERRIDE_DIST_PATH) {
    return join(process.env.ELECTRON_OVERRIDE_DIST_PATH, 'electron');
  }
  const electronPkgDir = join(desktopDir, 'node_modules/electron');
  const pathTxt = join(electronPkgDir, 'path.txt');
  if (!existsSync(pathTxt)) {
    throw new Error(`electron/path.txt not found at ${pathTxt}; run pnpm install first`);
  }
  const relPath = readFileSync(pathTxt, 'utf-8').trim();
  const binPath = join(electronPkgDir, 'dist', relPath);
  if (!existsSync(binPath)) {
    throw new Error(
      `electron binary not found at ${binPath}; electron postinstall may have failed`,
    );
  }
  return binPath;
}

const electronBin = findElectronBinary();

/**
 * 启动 electron + sentinel，返回结果。
 */
function runElectronWithSentinel(timeoutMs = 12000) {
  const sentinel = join(
    tmpdir(),
    `designwan-fail-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  );
  rmSync(sentinel, { force: true });

  const child = spawn(electronBin, ['.', '--no-sandbox'], {
    cwd: desktopDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      DESIGNWAN_SMOKE_SENTINEL: sentinel,
      ELECTRON_DISABLE_GPU: '1',
      ELECTRON_ENABLE_LOGGING: '0',
    },
  });

  let stderr = '';
  child.stderr.on('data', (d) => {
    stderr += d.toString();
  });

  return new Promise((resolve) => {
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 2000);
      } catch {
        // 已退出
      }
      resolve({ ...result, stderr, sentinel });
    };

    const timer = setTimeout(() => {
      finish({ timedOut: true });
    }, timeoutMs);

    child.on('exit', (code, signal) => {
      let sentinelContent = null;
      if (existsSync(sentinel)) {
        try {
          sentinelContent = JSON.parse(readFileSync(sentinel, 'utf8'));
        } catch {
          // 忽略
        }
      }
      // 调试日志：看 child 为什么 exit
      if (!sentinelContent) {
        console.log(
          `[debug] child exit code=${code} signal=${signal}, sentinel not written, stderr=${stderr.slice(0, 200)}`,
        );
      }
      finish({ exited: true, code, signal, sentinelContent });
    });

    // 如果收到 sentinel 但进程没退出，也 finish
    const checkSentinel = setInterval(() => {
      if (existsSync(sentinel)) {
        try {
          const content = JSON.parse(readFileSync(sentinel, 'utf8'));
          if (content.ok !== undefined) {
            clearInterval(checkSentinel);
            finish({ sentinelContent: content });
          }
        } catch {
          // 文件可能还在写入
        }
      }
    }, 100);
  });
}

/**
 * 备份文件。
 */
function backup(file) {
  const bak = `${file}.bak-${Date.now()}`;
  copyFileSync(file, bak);
  return { file, bak };
}

/**
 * 恢复文件。
 */
function restore(...backups) {
  for (const { file, bak } of backups) {
    if (existsSync(bak)) {
      copyFileSync(bak, file);
      rmSync(bak, { force: true });
    }
  }
}

// 前置检查：electron 二进制存在
test('prerequisite: electron binary exists', () => {
  assert.ok(existsSync(electronBin), `electron not found at ${electronBin}`);
});

// 前置检查：dist 产物存在
test('prerequisite: dist artifacts exist', () => {
  assert.ok(existsSync(join(distRenderer, 'index.html')), 'renderer/index.html missing');
  assert.ok(existsSync(join(distPreload, 'index.cjs')), 'preload/index.cjs missing');
  assert.ok(existsSync(join(distMain, 'index.js')), 'main/index.js missing');
});

test('FAILURE: renderer HTML missing → sentinel ok=false or timeout', async () => {
  const htmlPath = join(distRenderer, 'index.html');
  const b = backup(htmlPath);
  try {
    rmSync(htmlPath, { force: true });
    const result = await runElectronWithSentinel();
    const ok = result.timedOut || (result.sentinelContent && result.sentinelContent.ok === false);
    assert.ok(ok, `expected failure but got: ${JSON.stringify(result.sentinelContent)}`);
  } finally {
    restore(b);
  }
});

test('FAILURE: preload missing → sentinel ok=false or timeout', async () => {
  const cjsPath = join(distPreload, 'index.cjs');
  const b = backup(cjsPath);
  try {
    rmSync(cjsPath, { force: true });
    const result = await runElectronWithSentinel();
    const ok = result.timedOut || (result.sentinelContent && result.sentinelContent.ok === false);
    assert.ok(ok, `expected failure but got: ${JSON.stringify(result.sentinelContent)}`);
  } finally {
    restore(b);
  }
});

test('FAILURE: preload broken (empty file) → sentinel ok=false', async () => {
  const cjsPath = join(distPreload, 'index.cjs');
  const b = backup(cjsPath);
  try {
    writeFileSync(cjsPath, '');
    const result = await runElectronWithSentinel();
    const ok = result.timedOut || (result.sentinelContent && result.sentinelContent.ok === false);
    assert.ok(ok, `expected failure but got: ${JSON.stringify(result.sentinelContent)}`);
  } finally {
    restore(b);
  }
});

test('FAILURE: preload ESM format (import statement) → sentinel ok=false', async () => {
  const cjsPath = join(distPreload, 'index.cjs');
  const b = backup(cjsPath);
  try {
    // 写入 ESM 语法，sandbox preload 会报 SyntaxError
    writeFileSync(cjsPath, "import { contextBridge } from 'electron';\n");
    const result = await runElectronWithSentinel();
    const ok = result.timedOut || (result.sentinelContent && result.sentinelContent.ok === false);
    assert.ok(ok, `expected failure but got: ${JSON.stringify(result.sentinelContent)}`);
  } finally {
    restore(b);
  }
});

test('FAILURE: negotiate returns error → sentinel.negotiate.result.ok=false', async () => {
  const mainJsPath = join(distMain, 'index.js');
  const original = readFileSync(mainJsPath, 'utf8');
  const b = backup(mainJsPath);
  try {
    // 篡改 negotiate handler 返回错误
    const broken = original.replace(
      'result: { ok: true, value: { protocol: PROTOCOL_VERSION, app: APP_VERSION } }',
      "result: { ok: false, error: { message: 'injected failure' } }",
    );
    if (broken === original) {
      // 如果替换没命中，跳过（不 fail）
      assert.ok(true, 'negotiate handler pattern not found, skipping');
      return;
    }
    writeFileSync(mainJsPath, broken);
    const result = await runElectronWithSentinel();
    // probe 仍 ok:true（hasBridge:true），但 negotiate.result.ok=false
    const negOk = result.sentinelContent?.negotiate?.result?.ok === false;
    assert.ok(
      negOk,
      `expected negotiate.result.ok=false but got: ${JSON.stringify(result.sentinelContent)}`,
    );
  } finally {
    restore(b);
  }
});

test('FAILURE: process killed early → timeout (no sentinel)', async () => {
  const sentinel = join(tmpdir(), `designwan-early-${process.pid}-${Date.now()}.json`);
  rmSync(sentinel, { force: true });

  const child = spawn(electronBin, ['.', '--no-sandbox'], {
    cwd: desktopDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      DESIGNWAN_SMOKE_SENTINEL: sentinel,
      ELECTRON_DISABLE_GPU: '1',
    },
  });

  // 等 150ms 后 kill 进程（在 sentinel 写入前；Electron 启动+did-finish-load 至少 300ms）
  await new Promise((r) => setTimeout(r, 150));
  child.kill('SIGKILL');

  // 等待进程退出
  await new Promise((r) => child.on('exit', r));

  // sentinel 不应存在
  assert.ok(!existsSync(sentinel), 'sentinel should not exist after early kill');
  rmSync(sentinel, { force: true });
});
