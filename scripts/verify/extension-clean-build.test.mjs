#!/usr/bin/env node
/**
 * Extension 干净构建回归测试。
 *
 * 验证 stale artifact 不能让门禁假绿：
 *   1. FAILURE：删除 src/background.ts 后 `pnpm build` 必须失败，
 *      dist/background.js 必须不存在（旧产物已被清理，不能冒充当前构建）。
 *   2. RECOVERY：恢复 src/background.ts 后 `pnpm build` 必须成功，
 *      dist/background.js 必须存在。
 *
 * 注意：tsconfig.json 用 include glob，删除 background.ts 后 tsc -b 仍可能 exit 0
 * （因为 popup.ts 还在编译范围内），但 build 脚本里的 copy-manifest.mjs 会
 * 检查 manifest 引用的产物完整性，缺 background.js 时 exit 1。
 */
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, copyFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const extDir = join(root, 'apps/browser-extension');
const srcBackground = join(extDir, 'src/background.ts');
const distBackground = join(extDir, 'dist/background.js');

// 用 corepack pnpm 跑 build 脚本：rimraf dist && tsc -b && node scripts/build.mjs && copy-manifest.mjs
// copy-manifest.mjs 内置产物完整性校验，缺 background.js 时 exit 1
// 第五次整改 §E：用 corepack pnpm 代替直接 pnpm（pnpm 可能不在 PATH 中）
// 并检查 spawnSync 是否真的执行（status !== null），避免假绿
const pnpmBin = process.env.PNPM_BIN || 'corepack';
const pnpmPrefix = process.env.PNPM_BIN ? [] : ['pnpm'];

function runBuild(cwd) {
  return spawnSync(pnpmBin, [...pnpmPrefix, 'run', 'build'], {
    cwd,
    stdio: 'pipe',
    timeout: 120000,
    encoding: 'utf8',
  });
}

test('FAILURE: deleting src/background.ts → build must fail', () => {
  const bak = `${srcBackground}.bak-${Date.now()}`;
  copyFileSync(srcBackground, bak);

  try {
    rmSync(srcBackground, { force: true });
    rmSync(join(extDir, 'dist'), { force: true, recursive: true });
    rmSync(join(extDir, 'browser-extension.tsbuildinfo'), { force: true });

    const result = runBuild(extDir);

    // 检查 spawnSync 是否真的执行（status === null 表示命令未找到或信号终止）
    // 避免假绿：null !== 0 会被 notEqual 误判为通过
    assert.ok(
      result.status !== null,
      `spawnSync failed (status=null): ${result.error?.message || 'command not found'}\n` +
        `stderr: ${result.stderr}\nstdout: ${result.stdout}`,
    );

    if (result.status === 0) {
      console.error('build stderr:', result.stderr);
      console.error('build stdout:', result.stdout);
    }

    assert.notEqual(
      result.status,
      0,
      `build should fail when background.ts is deleted, got exit ${result.status}\n` +
        `stderr: ${result.stderr}\nstdout: ${result.stdout}`,
    );
    assert.ok(
      !existsSync(distBackground),
      'dist/background.js should not exist after failed build (no stale artifact allowed)',
    );
  } finally {
    if (existsSync(bak)) {
      copyFileSync(bak, srcBackground);
      rmSync(bak, { force: true });
    }
  }
});

test('RECOVERY: after restoring background.ts → build succeeds', () => {
  rmSync(join(extDir, 'dist'), { force: true, recursive: true });
  rmSync(join(extDir, 'browser-extension.tsbuildinfo'), { force: true });

  const result = runBuild(extDir);

  // 检查 spawnSync 是否真的执行（同上，防假绿）
  assert.ok(
    result.status !== null,
    `spawnSync failed (status=null): ${result.error?.message || 'command not found'}\n` +
      `stderr: ${result.stderr}\nstdout: ${result.stdout}`,
  );

  if (result.status !== 0) {
    console.error('build stderr:', result.stderr);
    console.error('build stdout:', result.stdout);
  }

  assert.equal(
    result.status,
    0,
    `build should succeed after restoring background.ts, got exit ${result.status}\n` +
      `stderr: ${result.stderr}\nstdout: ${result.stdout}`,
  );
  assert.ok(existsSync(distBackground), 'dist/background.js should exist after successful build');
});
