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
 *   5. 分段写入完整 sentinel → Smoke exit 0（短暂半截 JSON 不得误判损坏）
 *   6. negotiate 失败 → Smoke exit 1（sentinel.ok=false，negotiate error 证据）
 *   7. HTML 缺失 → exit 1（重新打包包含错误产物）
 *   8. Preload 缺失 → exit 1（重新打包包含错误产物）
 *   9. 正常 Packaged App → exit 0
 */
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync, mkdtempSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, relative } from 'node:path';
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
    spawnError: result.error,
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
function assertSmokeFailure(r, reasonCode, context) {
  assert.equal(
    r.spawnError,
    undefined,
    `smoke runner spawnSync must not fail, context: ${context}: ${r.spawnError?.message || ''}`,
  );
  assert.ok(
    !r.timedOut,
    `smoke should NOT time out (spawnSync timeout), context: ${context}\nstdout:\n${r.stdout.slice(-800)}`,
  );
  assert.equal(
    r.code,
    1,
    `expected exit 1 (precise), got code=${r.code} (null=timeout/signal), context: ${context}\nstdout:\n${r.stdout.slice(-800)}`,
  );
  assert.match(r.stdout, new RegExp(`REASON_CODE: ${reasonCode}(?:\\n|\\r|$)`));
  assert.match(r.stdout, /electron-packaged-ready-smoke: FAIL/);
}

function assertSmokeSuccess(r, context) {
  assert.equal(r.spawnError, undefined, `spawnSync error, context: ${context}`);
  assert.ok(!r.timedOut, `smoke should not time out, context: ${context}`);
  assert.equal(
    r.code,
    0,
    `expected exit 0, context: ${context}\nstdout:\n${r.stdout.slice(-800)}\nstderr:\n${r.stderr.slice(-400)}`,
  );
  assert.match(r.stdout, /electron-packaged-ready-smoke: PASS/);
}

/** Prove an injected failure fixture did not poison the next runner invocation. */
function assertRunnerRecovered(context) {
  const fake = createFakeExe(`
    const fs = require('fs');
    fs.writeFileSync(process.env.DESIGNWAN_SMOKE_SENTINEL, JSON.stringify({
      ok: true,
      readyState: 'complete',
      hasBridge: true,
      negotiate: { result: { ok: true, value: { protocol: '0.1.0', app: '0.0.0' } } }
    }), { flag: 'wx' });
    setTimeout(() => {}, 10000);
  `);
  try {
    assertSmokeSuccess(runSmokeTestMode(fake), `${context}: recovery`);
  } finally {
    rmSync(fake.tmpDir, { force: true, recursive: true });
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

test(
  'RUNNER: repo-relative --artifact path launches exact packaged app',
  { timeout: 120000 },
  () => {
    const exe = findPackagedExe();
    assert.ok(exe, 'packaged app prerequisite must exist');
    const repoRelativeArtifact = relative(root, exe);
    assert.ok(!repoRelativeArtifact.startsWith('..'), `artifact must be under repo: ${exe}`);
    assertSmokeSuccess(
      runSmoke(['--no-repackage', `--artifact=${repoRelativeArtifact}`]),
      'repo-relative --artifact',
    );
  },
);

// ── 测试模式注入接口测试（跨平台 Fixture）──────────────────

// 1. 立即 exit 0 → Smoke exit 1（early exit，sentinel 未收到）
test('RUNNER: immediate exit 0 → smoke exit 1 + early exit evidence', { timeout: 60000 }, () => {
  const fake = createFakeExe('process.exit(0);');
  try {
    const r = runSmokeTestMode(fake);
    assertSmokeFailure(r, 'ELECTRON_SMOKE_EARLY_EXIT', 'immediate exit 0');
  } finally {
    rmSync(fake.tmpDir, { force: true, recursive: true });
  }
  assertRunnerRecovered('immediate exit 0');
});

// 2. 立即 exit 1 → Smoke exit 1（early exit，sentinel 未收到）
test('RUNNER: immediate exit 1 → smoke exit 1 + early exit evidence', { timeout: 60000 }, () => {
  const fake = createFakeExe('process.exit(1);');
  try {
    const r = runSmokeTestMode(fake);
    assertSmokeFailure(r, 'ELECTRON_SMOKE_EARLY_EXIT', 'immediate exit 1');
  } finally {
    rmSync(fake.tmpDir, { force: true, recursive: true });
  }
  assertRunnerRecovered('immediate exit 1');
});

// 3. sleep 30 不写 sentinel → Smoke exit 1（timeout，sentinel 未收到）
test('RUNNER: ready timeout → smoke exit 1 + timeout evidence', { timeout: 60000 }, () => {
  const fake = createFakeExe('setTimeout(() => {}, 60000);');
  try {
    const r = runSmokeTestMode(fake, { DESIGNWAN_SMOKE_TEST_TIMEOUT_MS: '500' });
    assertSmokeFailure(r, 'ELECTRON_SMOKE_TIMEOUT', 'ready timeout');
  } finally {
    rmSync(fake.tmpDir, { force: true, recursive: true });
  }
  assertRunnerRecovered('ready timeout');
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
    assertSmokeFailure(r, 'ELECTRON_SMOKE_SENTINEL_CORRUPT', 'sentinel corrupted');
  } finally {
    rmSync(fake.tmpDir, { force: true, recursive: true });
  }
  assertRunnerRecovered('sentinel corrupted');
});

// 5. Windows 上文件创建和内容落盘并非原子动作；轮询读到半截 JSON 后应继续等待完整内容。
test('RUNNER: partially written sentinel recovers to success', { timeout: 60000 }, () => {
  const fake = createFakeExe(`
    const fs = require('fs');
    const file = process.env.DESIGNWAN_SMOKE_SENTINEL;
    const fd = fs.openSync(file, 'wx');
    fs.writeSync(fd, '{"ok":');
    setTimeout(() => {
      fs.writeSync(fd, 'true,"readyState":"complete","hasBridge":true,"negotiate":{"result":{"ok":true,"value":{"protocol":"0.1.0","app":"0.0.0"}}}}');
      fs.closeSync(fd);
    }, 300);
    setTimeout(() => {}, 10000);
  `);
  try {
    assertSmokeSuccess(runSmokeTestMode(fake), 'partially written sentinel');
  } finally {
    rmSync(fake.tmpDir, { force: true, recursive: true });
  }
});

// ── 真实 Packaged App 测试（需要 Electron + 重新打包）──────────

// 6. negotiate 失败 → Smoke exit 1（证明失败来自 negotiate）
test('RUNNER: negotiate failure → smoke exit 1 + negotiate evidence', { timeout: 120000 }, () => {
  const r = runSmoke(['--no-repackage'], {
    DESIGNWAN_TEST_NEGOTIATE_FAIL: '1',
  });
  assertSmokeFailure(r, 'ELECTRON_SMOKE_NEGOTIATE_FAILED', 'negotiate failure');
  assertSmokeSuccess(runSmoke(['--no-repackage']), 'negotiate failure: restored normal smoke');
});

// 7. HTML 缺失 → exit 1（重新打包包含错误产物）
test('RUNNER: renderer HTML missing → smoke exit 1', { timeout: 120000 }, () => {
  const htmlPath = join(desktopDir, 'dist/renderer/index.html');
  const b = backup(htmlPath);
  try {
    rmSync(htmlPath, { force: true });
    const r = runSmoke(); // 重新打包包含错误产物
    assertSmokeFailure(r, 'ELECTRON_SMOKE_RENDERER_LOAD_FAILED', 'renderer HTML missing');
  } finally {
    restore(b);
    assertSmokeSuccess(runSmoke(), 'renderer HTML missing: restored normal smoke');
  }
});

// 8. Preload 缺失 → exit 1（重新打包包含错误产物）
test('RUNNER: preload missing → smoke exit 1', { timeout: 120000 }, () => {
  const cjsPath = join(desktopDir, 'dist/preload/index.cjs');
  const b = backup(cjsPath);
  try {
    rmSync(cjsPath, { force: true });
    const r = runSmoke(); // 重新打包包含错误产物
    assertSmokeFailure(r, 'ELECTRON_SMOKE_PRELOAD_MISSING', 'preload missing');
  } finally {
    restore(b);
    assertSmokeSuccess(runSmoke(), 'preload missing: restored normal smoke');
  }
});

// 9. 正常 Packaged App → exit 0（恢复后证明正常）
test('RUNNER: normal packaged app → smoke exit 0', { timeout: 120000 }, () => {
  const r = runSmoke();
  assertSmokeSuccess(r, 'normal packaged app');
});
