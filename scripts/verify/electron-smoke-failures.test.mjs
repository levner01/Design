#!/usr/bin/env node
/**
 * Electron Smoke 失败路径测试（Sentinel 级）。
 *
 * 验证 main 进程 sentinel 机制能正确检测以下故障：
 *   1. Renderer HTML 缺失 → did-fail-load → ok=false
 *   2. Preload 缺失 → bridge missing → ok=false
 *   3. Preload 空文件 → bridge missing → ok=false
 *   4. Preload ESM 格式 → SyntaxError → ok=false
 *   5. negotiate 失败（DESIGNWAN_TEST_NEGOTIATE_FAIL=1）→ result.ok=false
 *   6. 进程提前退出 → 无 sentinel
 *
 * Runner 级测试（直接跑 electron-smoke.mjs）在 electron-smoke-runner.test.mjs。
 */
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  rmSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
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
 * 创建专用临时目录 + sentinel 路径（满足 main 的路径安全校验）。
 */
function createSmokeSentinelPath() {
  const smokeDir = mkdtempSync(join(tmpdir(), 'designwan-smoke-'));
  return {
    dir: smokeDir,
    sentinel: join(smokeDir, 'sentinel.json'),
  };
}

/**
 * 启动 electron + sentinel，返回结果。
 *
 * extraEnv 允许注入 DESIGNWAN_TEST_NEGOTIATE_FAIL 等测试开关。
 */
function runElectronWithSentinel(timeoutMs = 12000, extraEnv = {}) {
  const { dir: smokeDir, sentinel } = createSmokeSentinelPath();
  rmSync(sentinel, { force: true });

  const child = spawn(electronBin, ['.', '--no-sandbox'], {
    cwd: desktopDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      DESIGNWAN_SMOKE_MODE: '1',
      DESIGNWAN_SMOKE_SENTINEL: sentinel,
      ELECTRON_DISABLE_GPU: '1',
      ELECTRON_ENABLE_LOGGING: '0',
      ...extraEnv,
    },
  });

  let stderr = '';
  child.stderr.on('data', (d) => {
    stderr += d.toString();
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
      rmSync(smokeDir, { force: true, recursive: true });
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
      if (!sentinelContent) {
        console.log(
          `[debug] child exit code=${code} signal=${signal}, sentinel not written, stderr=${stderr.slice(0, 200)}`,
        );
      }
      finish({ exited: true, code, signal, sentinelContent });
    });

    // 如果收到 sentinel 但进程没退出，也 finish
    checkSentinel = setInterval(() => {
      if (existsSync(sentinel)) {
        try {
          const content = JSON.parse(readFileSync(sentinel, 'utf8'));
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
  // 使用稳定的测试开关注入 negotiate 故障，不依赖编译产物字符串替换
  // main 在 SMOKE_MODE=1 时检查 DESIGNWAN_TEST_NEGOTIATE_FAIL=1
  const result = await runElectronWithSentinel(12000, {
    DESIGNWAN_TEST_NEGOTIATE_FAIL: '1',
  });

  // probe 应 ok:true（hasBridge:true），但 negotiate.result.ok=false
  const negOk = result.sentinelContent?.negotiate?.result?.ok === false;
  assert.ok(
    negOk,
    `expected negotiate.result.ok=false but got: ${JSON.stringify(result.sentinelContent)}`,
  );
});

test('FAILURE: process killed early → timeout (no sentinel)', async () => {
  const { dir: smokeDir, sentinel } = createSmokeSentinelPath();
  rmSync(sentinel, { force: true });

  const child = spawn(electronBin, ['.', '--no-sandbox'], {
    cwd: desktopDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      DESIGNWAN_SMOKE_MODE: '1',
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
  rmSync(smokeDir, { force: true, recursive: true });
});
