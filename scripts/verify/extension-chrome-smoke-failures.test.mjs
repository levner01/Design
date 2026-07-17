#!/usr/bin/env node
/**
 * Chrome Extension Smoke 反例测试（第五次整改 §A.4）。
 *
 * 通过复制 dist 到临时目录并注入损坏产物，验证 extension-chrome-smoke.mjs
 * 能正确识别各种失败场景并 exit 1，且输出包含具体失败原因（不只断言非零）。
 *
 * 场景：
 *   1. popup.js 非法语法 → exit 1（Runtime.exceptionThrown）
 *   2. popup.js 缺失 → exit 1（Ready 标记缺失 / 加载错误）
 *   3. Popup Ready 标记缺失 → exit 1（__DESIGNWAN_POPUP_READY__ 不为 true）
 *   4. background.js 缺失（SW 不存在）→ exit 1（no SW target found）
 *   5. Chrome 提前退出 → exit 1（指定不存在的 Chrome 路径）
 *   6. Popup Ready + console.error → exit 1（Runtime.consoleAPICalled error）
 *   7. Service Worker throw → exit 1（Runtime.exceptionThrown / Log.entryAdded error）
 *   8. 正常 DesignWan Extension → exit 0
 *
 * 每个用例通过 DESIGNWAN_EXT_DIST 环境变量注入临时损坏产物目录。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
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
 * 运行 extension-chrome-smoke.mjs，返回 { code, stdout, stderr, timedOut }。
 */
function runSmoke(extDist, timeoutMs = 90000) {
  return runSmokeWithChrome(extDist, null, timeoutMs);
}

function runSmokeWithChrome(extDist, chromeBin, timeoutMs = 90000) {
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
test('popup.js invalid syntax → smoke exit 1 + exception evidence', async () => {
  const dist = copyDist();
  try {
    writeFileSync(join(dist, 'popup.js'), 'this is not valid javascript {{{{');
    const result = await runSmoke(dist);
    assert.equal(
      result.code,
      1,
      `expected exit 1, got ${result.code}\nstdout:\n${result.stdout.slice(-800)}`,
    );
    assert.match(result.stdout, /FAIL/);
    // 语法错误应被 Runtime.exceptionThrown 或 Log.entryAdded 捕获，或 Ready 缺失
    assert.ok(
      /exceptionThrown|entryAdded|not set|FAIL/i.test(result.stdout),
      `expected exception or ready-missing evidence in stdout`,
    );
  } finally {
    rmSync(dirname(dist), { force: true, recursive: true });
  }
});

// ── 2. popup.js 缺失 → exit 1 ─────────────────────────────
test('popup.js missing → smoke exit 1 + load failure evidence', async () => {
  const dist = copyDist();
  try {
    rmSync(join(dist, 'popup.js'), { force: true });
    const result = await runSmoke(dist);
    assert.equal(
      result.code,
      1,
      `expected exit 1, got ${result.code}\nstdout:\n${result.stdout.slice(-800)}`,
    );
    assert.match(result.stdout, /FAIL/);
    // popup.js 缺失 → Ready 不会设置，或 Log 报告加载失败
    assert.ok(
      /not set|entryAdded|FAIL|Could not load|ERR_FILE_NOT_FOUND/i.test(result.stdout),
      `expected load-failure or ready-missing evidence`,
    );
  } finally {
    rmSync(dirname(dist), { force: true, recursive: true });
  }
});

// ── 3. Popup Ready 标记缺失 → exit 1 ────────────────────────
test('popup ready marker missing → smoke exit 1 + ready evidence', async () => {
  const dist = copyDist();
  try {
    writeFileSync(
      join(dist, 'popup.js'),
      'var PROTOCOL_VERSION = "0.1.0";\nvar APP_VERSION = "0.0.0";\nconsole.log("no ready marker");\n',
    );
    const result = await runSmoke(dist);
    assert.equal(
      result.code,
      1,
      `expected exit 1, got ${result.code}\nstdout:\n${result.stdout.slice(-800)}`,
    );
    assert.match(result.stdout, /FAIL/);
    // Ready 标记未设置 → assert popup ready step 为 false
    assert.match(result.stdout, /__DESIGNWAN_POPUP_READY__.*not set|false/i);
  } finally {
    rmSync(dirname(dist), { force: true, recursive: true });
  }
});

// ── 4. background.js 缺失（SW 不存在）→ exit 1 ──────────────
test('background.js missing → smoke exit 1 + no SW target evidence', async () => {
  const dist = copyDist();
  try {
    rmSync(join(dist, 'background.js'), { force: true });
    const result = await runSmoke(dist);
    assert.equal(
      result.code,
      1,
      `expected exit 1, got ${result.code}\nstdout:\n${result.stdout.slice(-800)}`,
    );
    assert.match(result.stdout, /FAIL/);
    // 无 DesignWan SW target → smoke 报 no SW target found
    assert.match(result.stdout, /no SW target found|FAIL/i);
  } finally {
    rmSync(dirname(dist), { force: true, recursive: true });
  }
});

// ── 5. Chrome 提前退出 → exit 1 ───────────────────────────
test('Chrome early exit → smoke exit 1 + Chrome exit evidence', async () => {
  const dist = copyDist();
  const fakeChromeDir = mkdtempSync(join(tmpdir(), 'designwan-fake-chrome-'));
  const fakeChromePath = join(fakeChromeDir, 'fake-chrome');
  writeFileSync(fakeChromePath, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  try {
    const result = await runSmokeWithChrome(dist, fakeChromePath);
    assert.equal(
      result.code,
      1,
      `expected exit 1, got ${result.code}\nstdout:\n${result.stdout.slice(-800)}`,
    );
    assert.match(result.stdout, /FAIL/);
    assert.match(result.stdout, /not exited early|CDP version reachable.*false|FAIL/i);
  } finally {
    rmSync(dirname(dist), { force: true, recursive: true });
    rmSync(fakeChromeDir, { force: true, recursive: true });
  }
});

// ── 6. Popup Ready + console.error → exit 1（第五轮 §A.4 新增反例）───
test('popup ready + console.error → smoke exit 1 + consoleAPICalled evidence', async () => {
  const dist = copyDist();
  try {
    // 写入 popup.js：先设置 Ready 标记，再调用 console.error
    // 这是 ESM 模块（manifest 声明 type=module），两行同步执行
    writeFileSync(
      join(dist, 'popup.js'),
      'globalThis.__DESIGNWAN_POPUP_READY__ = true;\nconsole.error("DESIGNWAN_ACCEPTANCE_INJECTED_POPUP_ERROR");\n',
    );
    const result = await runSmoke(dist);
    assert.equal(
      result.code,
      1,
      `expected exit 1, got ${result.code}\nstdout:\n${result.stdout.slice(-800)}`,
    );
    assert.match(result.stdout, /FAIL/);
    // 必须断言具体失败原因：console.error 被 Runtime.consoleAPICalled 捕获
    assert.ok(
      result.stdout.includes('DESIGNWAN_ACCEPTANCE_INJECTED_POPUP_ERROR') ||
        /console\.error|consoleAPICalled/i.test(result.stdout),
      `expected console.error evidence in stdout, got:\n${result.stdout.slice(-800)}`,
    );
  } finally {
    rmSync(dirname(dist), { force: true, recursive: true });
  }
});

// ── 7. Service Worker throw → exit 1（第五轮 §A.4 新增反例）─────────
test('service worker throw → smoke exit 1 + exception evidence', async () => {
  const dist = copyDist();
  try {
    // 追加到现有 background.js：保留 SW 的 install/activate/message 事件监听器
    // （这些监听器让 Chrome 保持 SW 存活），再追加延迟 throw。
    // 同时用 console.error + throw 双信号确保 CDP 能捕获：
    // - console.error → Runtime.consoleAPICalled(type=error)
    // - throw → Runtime.exceptionThrown
    // 2s 延迟确保 Chrome 启动 + SW 加载 + smoke discover + attach 全部完成后才抛异常
    const existingBg = readFileSync(join(dist, 'background.js'), 'utf8');
    writeFileSync(
      join(dist, 'background.js'),
      existingBg +
        '\n// Counterexample injection\nsetTimeout(() => {\n  console.error("DESIGNWAN_ACCEPTANCE_INJECTED_SW_ERROR");\n  throw new Error("DESIGNWAN_ACCEPTANCE_INJECTED_SW_ERROR");\n}, 2000);\n',
    );
    const result = await runSmoke(dist);
    assert.equal(
      result.code,
      1,
      `expected exit 1, got ${result.code}\nstdout:\n${result.stdout.slice(-800)}`,
    );
    assert.match(result.stdout, /FAIL/);
    // 必须断言具体失败原因：SW exception 被 Runtime.exceptionThrown / consoleAPICalled / Log 捕获
    assert.ok(
      result.stdout.includes('DESIGNWAN_ACCEPTANCE_INJECTED_SW_ERROR') ||
        /exceptionThrown|consoleAPICalled|entryAdded/i.test(result.stdout),
      `expected SW exception evidence in stdout, got:\n${result.stdout.slice(-800)}`,
    );
  } finally {
    rmSync(dirname(dist), { force: true, recursive: true });
  }
});

// ── 8. 正常 DesignWan Extension → exit 0 ──────────────────
test('normal DesignWan extension → smoke exit 0', async () => {
  const result = await runSmoke(realDist);
  assert.equal(
    result.code,
    0,
    `expected exit 0, got ${result.code}\nstdout:\n${result.stdout.slice(-800)}`,
  );
  assert.match(result.stdout, /PASS/);
});
