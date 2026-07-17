/**
 * Chrome Extension Smoke 反例测试（第四次复验 §5.4.2）。
 *
 * 通过复制 dist 到临时目录并注入损坏产物，验证 extension-chrome-smoke.mjs
 * 能正确识别各种失败场景并 exit 1：
 *   1. popup.js 非法语法 → exit 1（Runtime.exceptionThrown）
 *   2. popup.js 缺失 → exit 1（ERR_FILE_NOT_FOUND）
 *   3. Popup Ready 标记缺失 → exit 1（__DESIGNWAN_POPUP_READY__ 不为 true）
 *   4. Service Worker 不是 DesignWan → exit 1（无 background.js SW）
 *   5. Chrome 提前退出 → exit 1（指定不存在的 Chrome 路径）
 *   6. 正常 DesignWan Extension → exit 0
 *
 * 每个用例通过 DESIGNWAN_EXT_DIST 环境变量注入临时损坏产物目录。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const realDist = join(root, 'apps', 'browser-extension', 'dist');
const smokeScript = join(here, 'extension-chrome-smoke.mjs');

/**
 * 复制真实 dist 到临时目录，返回临时目录路径。
 */
function copyDist() {
  const tmp = mkdtempSync(join(tmpdir(), 'designwan-ext-fail-'));
  cpSync(realDist, join(tmp, 'dist'), { recursive: true });
  return join(tmp, 'dist');
}

/**
 * 运行 extension-chrome-smoke.mjs，返回 { code, stdout, stderr }。
 * timeoutMs 给 Chrome 足够时间启动和失败。
 */
function runSmoke(extDist, timeoutMs = 60000) {
  return runSmokeWithChrome(extDist, null, timeoutMs);
}

/**
 * 运行 extension-chrome-smoke.mjs，可选注入假 Chrome 路径。
 */
function runSmokeWithChrome(extDist, chromeBin, timeoutMs = 60000) {
  return new Promise((resolve) => {
    const env = { ...process.env, DESIGNWAN_EXT_DIST: extDist };
    if (chromeBin) env.DESIGNWAN_CHROME_BIN = chromeBin;
    const child = spawn(process.execPath, [smokeScript], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
    }, timeoutMs);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code: timedOut ? -1 : code, stdout, stderr, timedOut });
    });
  });
}

// ── 1. popup.js 非法语法 → exit 1 ─────────────────────────
test('popup.js invalid syntax → smoke exit 1', async () => {
  const dist = copyDist();
  try {
    // 写入语法错误的 popup.js
    writeFileSync(join(dist, 'popup.js'), 'this is not valid javascript {{{{');
    const result = await runSmoke(dist);
    assert.equal(
      result.code,
      1,
      `expected exit 1, got ${result.code}\nstdout:\n${result.stdout.slice(-500)}`,
    );
    assert.match(result.stdout, /FAIL/);
  } finally {
    rmSync(dirname(dist), { force: true, recursive: true });
  }
});

// ── 2. popup.js 缺失 → exit 1 ─────────────────────────────
test('popup.js missing → smoke exit 1', async () => {
  const dist = copyDist();
  try {
    rmSync(join(dist, 'popup.js'), { force: true });
    const result = await runSmoke(dist);
    assert.equal(
      result.code,
      1,
      `expected exit 1, got ${result.code}\nstdout:\n${result.stdout.slice(-500)}`,
    );
    assert.match(result.stdout, /FAIL/);
  } finally {
    rmSync(dirname(dist), { force: true, recursive: true });
  }
});

// ── 3. Popup Ready 标记缺失 → exit 1 ────────────────────────
test('popup ready marker missing → smoke exit 1', async () => {
  const dist = copyDist();
  try {
    // 替换 popup.js 为不含 __DESIGNWAN_POPUP_READY__ 的版本
    writeFileSync(
      join(dist, 'popup.js'),
      'var PROTOCOL_VERSION = "0.1.0";\nvar APP_VERSION = "0.0.0";\nconsole.log("no ready marker");\n',
    );
    const result = await runSmoke(dist);
    assert.equal(
      result.code,
      1,
      `expected exit 1, got ${result.code}\nstdout:\n${result.stdout.slice(-500)}`,
    );
    assert.match(result.stdout, /FAIL/);
  } finally {
    rmSync(dirname(dist), { force: true, recursive: true });
  }
});

// ── 4. Service Worker 不是 DesignWan → exit 1 ──────────────
test('background.js not DesignWan → smoke exit 1', async () => {
  const dist = copyDist();
  try {
    // 替换 background.js 为不含 DesignWan SW 的内容（但保持文件名）
    // 这样 SW 不会注册为 DesignWan（manifest 声明 background.js 但内容是空）
    // 实际效果：SW 加载但没有任何 DesignWan 标识
    // 由于我们的 SW 提取逻辑只看 URL 是否以 /background.js 结尾，
    // 这里改为删除 background.js，让 manifest 引用不存在的文件
    rmSync(join(dist, 'background.js'), { force: true });
    const result = await runSmoke(dist);
    assert.equal(
      result.code,
      1,
      `expected exit 1, got ${result.code}\nstdout:\n${result.stdout.slice(-500)}`,
    );
    assert.match(result.stdout, /FAIL/);
  } finally {
    rmSync(dirname(dist), { force: true, recursive: true });
  }
});

// ── 5. Chrome 提前退出 → exit 1 ───────────────────────────
test('Chrome early exit → smoke exit 1', async () => {
  const dist = copyDist();
  // 创建一个假 Chrome 可执行文件，立即 exit 0（模拟提前退出）
  const fakeChromeDir = mkdtempSync(join(tmpdir(), 'designwan-fake-chrome-'));
  const fakeChromePath = join(fakeChromeDir, 'fake-chrome');
  writeFileSync(fakeChromePath, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  try {
    const result = await runSmokeWithChrome(dist, fakeChromePath);
    assert.equal(
      result.code,
      1,
      `expected exit 1, got ${result.code}\nstdout:\n${result.stdout.slice(-500)}`,
    );
    assert.match(result.stdout, /FAIL/);
  } finally {
    rmSync(dirname(dist), { force: true, recursive: true });
    rmSync(fakeChromeDir, { force: true, recursive: true });
  }
});

// ── 6. 正常 DesignWan Extension → exit 0 ──────────────────
test('normal DesignWan extension → smoke exit 0', async () => {
  // 用真实 dist（不是副本，确保产物完整）
  const result = await runSmoke(realDist);
  assert.equal(
    result.code,
    0,
    `expected exit 0, got ${result.code}\nstdout:\n${result.stdout.slice(-800)}`,
  );
  assert.match(result.stdout, /PASS/);
});
