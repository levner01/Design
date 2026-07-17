#!/usr/bin/env node
/**
 * Electron Smoke Runner 级失败测试。
 *
 * 直接执行 `node scripts/verify/electron-smoke.mjs`（或加 --no-repackage），
 * 验证 smoke runner 本身能正确判定失败，不只是 sentinel 逻辑。
 *
 * 第四次复验 §5.4.1 要求：Runner 级失败测试必须直接执行 electron-smoke.mjs。
 *
 * 场景：
 *   1. 立即 exit 0 → Smoke exit 1
 *   2. 立即 exit 1 → Smoke exit 1
 *   3. HTML 缺失 → exit 1（重新打包包含错误产物）
 *   4. Preload 缺失 → exit 1（重新打包包含错误产物）
 *   5. negotiate 失败 → exit 1
 *   6. Ready Timeout → exit 1
 *   7. Sentinel 损坏 → exit 1
 *   8. 正常 Packaged App → exit 0
 */
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  rmSync,
  mkdtempSync,
  writeFileSync,
  copyFileSync,
  chmodSync,
  readFileSync,
} from 'node:fs';
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
 * 运行 electron-smoke.mjs，返回 exit code。
 */
function runSmoke(args = [], env = {}) {
  const result = spawnSync('node', [smokeScript, ...args], {
    cwd: root,
    stdio: 'pipe',
    timeout: 120000,
    env: { ...process.env, ...env },
  });
  return {
    code: result.status,
    stdout: result.stdout?.toString() || '',
    stderr: result.stderr?.toString() || '',
  };
}

/**
 * 创建假 exe 脚本（shell 脚本，chmod +x）。
 */
function createFakeExe(content) {
  const tmpDir = mkdtempSync(join(tmpdir(), 'designwan-fake-exe-'));
  const fakeExe = join(tmpDir, 'fake-designwan');
  writeFileSync(fakeExe, `#!/bin/sh\n${content}\n`);
  chmodSync(fakeExe, 0o755);
  return { fakeExe, tmpDir };
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

// 1. 立即 exit 0 → Smoke exit 1
test('RUNNER: immediate exit 0 → smoke exit 1', { timeout: 60000 }, () => {
  const exe = findPackagedExe();
  assert.ok(exe, 'packaged exe missing');
  const b = backup(exe);
  const { fakeExe, tmpDir } = createFakeExe('exit 0');
  try {
    copyFileSync(fakeExe, exe);
    chmodSync(exe, 0o755);
    const r = runSmoke(['--no-repackage']);
    assert.notEqual(
      r.code,
      0,
      `smoke should exit non-zero for immediate-exit-0 exe, got ${r.code}\n${r.stdout}`,
    );
  } finally {
    restore(b);
    rmSync(tmpDir, { force: true, recursive: true });
  }
});

// 2. 立即 exit 1 → Smoke exit 1
test('RUNNER: immediate exit 1 → smoke exit 1', { timeout: 60000 }, () => {
  const exe = findPackagedExe();
  assert.ok(exe, 'packaged exe missing');
  const b = backup(exe);
  const { fakeExe, tmpDir } = createFakeExe('exit 1');
  try {
    copyFileSync(fakeExe, exe);
    chmodSync(exe, 0o755);
    const r = runSmoke(['--no-repackage']);
    assert.notEqual(
      r.code,
      0,
      `smoke should exit non-zero for immediate-exit-1 exe, got ${r.code}\n${r.stdout}`,
    );
  } finally {
    restore(b);
    rmSync(tmpDir, { force: true, recursive: true });
  }
});

// 3. HTML 缺失 → exit 1（重新打包包含错误产物）
test('RUNNER: renderer HTML missing → smoke exit 1', { timeout: 120000 }, () => {
  const htmlPath = join(desktopDir, 'dist/renderer/index.html');
  const b = backup(htmlPath);
  try {
    rmSync(htmlPath, { force: true });
    const r = runSmoke(); // 不用 --no-repackage，让 smoke 重新打包包含错误
    assert.notEqual(
      r.code,
      0,
      `smoke should exit non-zero for missing HTML, got ${r.code}\n${r.stdout}`,
    );
  } finally {
    restore(b);
    // 恢复后重新打包恢复正常产物
    runSmoke(['--no-repackage']);
  }
});

// 4. Preload 缺失 → exit 1（重新打包包含错误产物）
test('RUNNER: preload missing → smoke exit 1', { timeout: 120000 }, () => {
  const cjsPath = join(desktopDir, 'dist/preload/index.cjs');
  const b = backup(cjsPath);
  try {
    rmSync(cjsPath, { force: true });
    const r = runSmoke();
    assert.notEqual(
      r.code,
      0,
      `smoke should exit non-zero for missing preload, got ${r.code}\n${r.stdout}`,
    );
  } finally {
    restore(b);
    runSmoke(['--no-repackage']);
  }
});

// 5. negotiate 失败 → exit 1
test('RUNNER: negotiate failure → smoke exit 1', { timeout: 60000 }, () => {
  const r = runSmoke(['--no-repackage'], {
    DESIGNWAN_TEST_NEGOTIATE_FAIL: '1',
  });
  assert.notEqual(
    r.code,
    0,
    `smoke should exit non-zero for negotiate failure, got ${r.code}\n${r.stdout}`,
  );
});

// 6. Ready Timeout → exit 1（exe 为 sleep 30，不写 sentinel）
test('RUNNER: ready timeout → smoke exit 1', { timeout: 60000 }, () => {
  const exe = findPackagedExe();
  assert.ok(exe, 'packaged exe missing');
  const b = backup(exe);
  const { fakeExe, tmpDir } = createFakeExe('sleep 30');
  try {
    copyFileSync(fakeExe, exe);
    chmodSync(exe, 0o755);
    const r = runSmoke(['--no-repackage']);
    assert.notEqual(
      r.code,
      0,
      `smoke should exit non-zero for ready timeout, got ${r.code}\n${r.stdout}`,
    );
  } finally {
    restore(b);
    rmSync(tmpDir, { force: true, recursive: true });
  }
});

// 7. Sentinel 损坏 → exit 1（exe 写损坏 JSON 到 sentinel 路径）
test('RUNNER: sentinel corrupted → smoke exit 1', { timeout: 60000 }, () => {
  const exe = findPackagedExe();
  assert.ok(exe, 'packaged exe missing');
  const b = backup(exe);
  // 假 exe 读 DESIGNWAN_SMOKE_SENTINEL 环境变量，写损坏 JSON
  const { fakeExe, tmpDir } = createFakeExe(
    'if [ -n "$DESIGNWAN_SMOKE_SENTINEL" ]; then echo "{bad json" > "$DESIGNWAN_SMOKE_SENTINEL"; fi\nexit 0',
  );
  try {
    copyFileSync(fakeExe, exe);
    chmodSync(exe, 0o755);
    const r = runSmoke(['--no-repackage']);
    assert.notEqual(
      r.code,
      0,
      `smoke should exit non-zero for corrupted sentinel, got ${r.code}\n${r.stdout}`,
    );
  } finally {
    restore(b);
    rmSync(tmpDir, { force: true, recursive: true });
  }
});

// 8. 正常 Packaged App → exit 0
test('RUNNER: normal packaged app → smoke exit 0', { timeout: 120000 }, () => {
  const r = runSmoke();
  assert.equal(
    r.code,
    0,
    `smoke should exit 0 for normal packaged app, got ${r.code}\n${r.stdout}`,
  );
});
