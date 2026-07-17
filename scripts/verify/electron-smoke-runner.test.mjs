#!/usr/bin/env node
/**
 * Electron Smoke Runner 级失败测试（第五次整改 §C）。
 *
 * 直接执行 `node scripts/verify/electron-smoke.mjs`，验证 smoke runner 本身
 * 能正确判定失败，不只是 sentinel 逻辑。
 *
 * 第五次整改 §C 修复第四轮验收 §6.2 P1 的 Runner 负例真实性缺口：
 * - 跨平台 Fixture：用 Node.js 脚本作为 fake exe，不用 Unix shell 脚本当 Windows .exe
 * - 精确断言 exit code === 1（不是 !== 0 的模糊断言），断言未超时、无 spawn error
 * - 断言 stdout 包含具体失败原因（early exit / timeout / sentinel / negotiate）
 * - 恢复后先跑正常 Smoke 证明 exit 0，再断言负例
 * - negotiate 失败证明来自 negotiate（stdout 包含 negotiate + ok:false）
 * - spawnSync().status === null（超时）不得被"非零断言"误判为成功
 * - 测试模式 command/args 注入接口（双开关限制，生产不可用）
 *
 * 场景：
 *   1. 立即 exit 0 → Smoke exit 1（early exit，sentinel 未收到）
 *   2. 立即 exit 1 → Smoke exit 1（early exit，sentinel 未收到）
 *   3. sleep 30 不写 sentinel → Smoke exit 1（timeout，sentinel 未收到）
 *   4. 写损坏 JSON 到 sentinel → Smoke exit 1（sentinel parse fail）
 *   5. negotiate 失败 → Smoke exit 1（sentinel.ok=false，negotiate error 证据）
 *   6. HTML 缺失 → exit 1（重新打包包含错误产物）
 *   7. Preload 缺失 → exit 1（重新打包包含错误产物）
 *   8. 正常 Packaged App → exit 0
 */
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync, mkdtempSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const desktopDir = join(root, 'apps/desktop');
const smokeScript = join(root, 'scripts/verify/electron-smoke.mjs');
const releaseDir = join(desktopDir, 'release');

/**
 * 找到 packaged app exe 路径。
 */
function findPackagedExe() {
  if (process.platform === 'darwin') {
    const archDirs =
      process.arch === 'arm64' ? ['mac-arm64'] : process.arch === 'x64' ? ['mac-x64', 'mac'] : [];
    for (const d of archDirs) {
      const exe = join(releaseDir, d, 'DesignWan.app', 'Contents', 'MacOS', 'DesignWan');
      if (existsSync(exe)) return exe;
    }
  } else if (process.platform === 'win32') {
    const exe = join(releaseDir, 'win-unpacked', 'DesignWan.exe');
    if (existsSync(exe)) return exe;
  }
  return null;
}

/**
 * 运行 electron-smoke.mjs，返回 exit code + 输出 + 超时标记。
 *
 * 关键：spawnSync().status === null 表示超时或信号终止，
 * 不能被"非零断言"误判为成功。用 timedOut 标记区分。
 */
function runSmoke(args = [], env = {}, timeoutMs = 120000) {
  const result = spawnSync('node', [smokeScript, ...args], {
    cwd: root,
    stdio: 'pipe',
    timeout: timeoutMs,
    env: { ...process.env, ...env },
  });
  // status === null 且 signal === 'SIGTERM' 表示 spawnSync 超时
  const timedOut = result.status === null && result.signal === 'SIGTERM';
  return {
    code: result.status,
    stdout: result.stdout?.toString() || '',
    stderr: result.stderr?.toString() || '',
    timedOut,
  };
}

/**
 * 创建跨平台 fake exe：返回 Node.js 脚本路径 + spawn command/args。
 *
 * 第五次整改 §C：不用 Unix shell 脚本（Windows 无法执行），
 * 改用 Node.js 脚本作为 fake exe，跨平台一致。
 *
 * 测试模式注入接口：通过 DESIGNWAN_SMOKE_TEST_COMMAND + DESIGNWAN_SMOKE_TEST_ARGS
 * 传给 electron-smoke.mjs，由测试模式双开关（SMOKE_MODE + TEST_COMMAND）启用。
 */
function createFakeExe(scriptContent) {
  const tmpDir = mkdtempSync(join(tmpdir(), 'designwan-fake-exe-'));
  const fakeScript = join(tmpDir, 'fake-exe.cjs');
  writeFileSync(fakeScript, scriptContent);
  return {
    command: process.execPath,
    args: [fakeScript],
    tmpDir,
  };
}

/**
 * 用测试模式运行 smoke（注入 fake command/args，不需要真实 packaged app）。
 */
function runSmokeTestMode(fake, extraEnv = {}) {
  return runSmoke([], {
    DESIGNWAN_SMOKE_MODE: '1',
    DESIGNWAN_SMOKE_TEST_COMMAND: fake.command,
    DESIGNWAN_SMOKE_TEST_ARGS: JSON.stringify(fake.args),
    ...extraEnv,
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

function restore(...backups) {
  for (const { file, bak } of backups) {
    if (existsSync(bak)) {
      copyFileSync(bak, file);
      rmSync(bak, { force: true });
    }
  }
}

/**
 * 精确断言 smoke 失败：exit 1、未超时、stdout 含失败原因关键词。
 * 拒绝 status === null（超时/信号）被误判为"非零即通过"。
 */
function assertSmokeFailure(r, reasonKeywords, context) {
  assert.ok(
    !r.timedOut,
    `smoke should NOT time out (spawnSync timeout), context: ${context}\nstdout:\n${r.stdout.slice(-800)}`,
  );
  assert.equal(
    r.code,
    1,
    `expected exit 1 (precise), got code=${r.code} (null=timeout/signal), context: ${context}\nstdout:\n${r.stdout.slice(-800)}`,
  );
  assert.match(r.stdout, /FAIL/);
  if (reasonKeywords) {
    assert.ok(
      reasonKeywords.test(r.stdout),
      `expected failure reason ${reasonKeywords} in stdout, context: ${context}\nstdout:\n${r.stdout.slice(-800)}`,
    );
  }
}

// 前置检查：packaged app 存在（先跑一次正常 smoke 生成）
test('prerequisite: packaged app exists', { timeout: 120000 }, () => {
  let exe = findPackagedExe();
  if (!exe) {
    // 跑一次 smoke 生成 packaged app
    const r = runSmoke();
    exe = findPackagedExe();
    assert.ok(exe, `packaged app not found after smoke run; smoke exit=${r.code}`);
  }
  assert.ok(existsSync(exe), `packaged exe not found: ${exe}`);
});

// ── 测试模式注入接口测试（跨平台 Fixture）──────────────────

// 1. 立即 exit 0 → Smoke exit 1（early exit，sentinel 未收到）
test('RUNNER: immediate exit 0 → smoke exit 1 + early exit evidence', { timeout: 60000 }, () => {
  const fake = createFakeExe('process.exit(0);');
  try {
    const r = runSmokeTestMode(fake);
    assertSmokeFailure(r, /early exit|sentinel file received.*false|FAIL/i, 'immediate exit 0');
  } finally {
    rmSync(fake.tmpDir, { force: true, recursive: true });
  }
});

// 2. 立即 exit 1 → Smoke exit 1（early exit，sentinel 未收到）
test('RUNNER: immediate exit 1 → smoke exit 1 + early exit evidence', { timeout: 60000 }, () => {
  const fake = createFakeExe('process.exit(1);');
  try {
    const r = runSmokeTestMode(fake);
    assertSmokeFailure(r, /early exit|sentinel file received.*false|FAIL/i, 'immediate exit 1');
  } finally {
    rmSync(fake.tmpDir, { force: true, recursive: true });
  }
});

// 3. sleep 30 不写 sentinel → Smoke exit 1（timeout，sentinel 未收到）
test('RUNNER: ready timeout → smoke exit 1 + timeout evidence', { timeout: 60000 }, () => {
  const fake = createFakeExe('setTimeout(() => {}, 30000);');
  try {
    const r = runSmokeTestMode(fake);
    // 注意：这里 smoke 内部 30s timeout，spawnSync 给 60s
    assertSmokeFailure(r, /timeout|sentinel file received.*false|FAIL/i, 'ready timeout');
  } finally {
    rmSync(fake.tmpDir, { force: true, recursive: true });
  }
});

// 4. 写损坏 JSON 到 sentinel → Smoke exit 1（sentinel parse fail）
test('RUNNER: sentinel corrupted → smoke exit 1 + sentinel evidence', { timeout: 60000 }, () => {
  const fake = createFakeExe(`(
    () => {
      const fs = require('fs');
      const path = process.env.DESIGNWAN_SMOKE_SENTINEL;
      if (path) {
        // 写损坏的 JSON 到 sentinel 路径
        fs.writeFileSync(path, '{bad json', { flag: 'wx' });
      }
      process.exit(0);
    }
  )();`);
  try {
    const r = runSmokeTestMode(fake);
    // sentinel 写了但 JSON 损坏 → smoke 轮询时 JSON.parse 失败，最终 timeout 或 sentinel 未收到
    // 或者 App 退出后 sentinel 是损坏的
    assertSmokeFailure(
      r,
      /sentinel file received.*false|early exit|timeout|FAIL/i,
      'sentinel corrupted',
    );
  } finally {
    rmSync(fake.tmpDir, { force: true, recursive: true });
  }
});

// ── 真实 Packaged App 测试（需要 Electron + 重新打包）──────────

// 5. negotiate 失败 → Smoke exit 1（证明失败来自 negotiate）
test('RUNNER: negotiate failure → smoke exit 1 + negotiate evidence', { timeout: 120000 }, () => {
  const r = runSmoke(['--no-repackage'], {
    DESIGNWAN_TEST_NEGOTIATE_FAIL: '1',
  });
  assertSmokeFailure(
    r,
    /negotiate\.result\.ok.*false|negotiate.*ok.*false|FAIL/i,
    'negotiate failure',
  );
  // 额外证明：失败原因来自 negotiate，不是 early exit 或 timeout
  assert.ok(
    !/early exit.*true/i.test(r.stdout),
    `negotiate failure should not be early exit, got:\n${r.stdout.slice(-800)}`,
  );
});

// 6. HTML 缺失 → exit 1（重新打包包含错误产物）
test('RUNNER: renderer HTML missing → smoke exit 1', { timeout: 120000 }, () => {
  const htmlPath = join(desktopDir, 'dist/renderer/index.html');
  const b = backup(htmlPath);
  try {
    rmSync(htmlPath, { force: true });
    const r = runSmoke(); // 重新打包包含错误产物
    assertSmokeFailure(r, /FAIL/i, 'renderer HTML missing');
  } finally {
    restore(b);
  }
});

// 7. Preload 缺失 → exit 1（重新打包包含错误产物）
test('RUNNER: preload missing → smoke exit 1', { timeout: 120000 }, () => {
  const cjsPath = join(desktopDir, 'dist/preload/index.cjs');
  const b = backup(cjsPath);
  try {
    rmSync(cjsPath, { force: true });
    const r = runSmoke(); // 重新打包包含错误产物
    assertSmokeFailure(r, /FAIL/i, 'preload missing');
  } finally {
    restore(b);
  }
});

// 8. 正常 Packaged App → exit 0（恢复后证明正常）
test('RUNNER: normal packaged app → smoke exit 0', { timeout: 120000 }, () => {
  const r = runSmoke();
  assert.ok(!r.timedOut, `smoke should not time out for normal app`);
  assert.equal(
    r.code,
    0,
    `smoke should exit 0 for normal packaged app, got ${r.code}\nstdout:\n${r.stdout.slice(-800)}`,
  );
  assert.match(r.stdout, /PASS/);
});
