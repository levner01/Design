#!/usr/bin/env node
/**
 * DesignWan verify:quick
 *
 * 任务卡 GLM-M0-01 §6 + 复验条件 §6：
 * Format/Lint/Typecheck/依赖方向/Build/产物完整性/启动 smoke。
 *
 * 真实执行的子门：
 *   1. 依赖方向检查（scripts/check-deps.mjs）
 *   2. Prettier 格式检查
 *   3. TypeScript Project References 构建（tsc -b）
 *   4. Turbo build（所有 workspace 包，含 esbuild 打包）
 *   5. Browser Extension manifest 解析 + 产物引用完整性
 *   6. Desktop 安全配置静态检查
 *   7. Desktop 产物完整性检查（dist/ 文件齐全）
 *   8. Electron Packaged Ready smoke（正向 Ready 证据，禁止跳过）
 *   9. Electron smoke 失败路径测试（HTML/Preload/negotiate/超时/提前退出）
 *   10. Native Host 协议测试（单 chunk / 拆 chunk / 连续帧 / 超长帧 / 50 轮）
 *   11. Extension Chrome 加载 smoke（Popup/SW/Ready 标记）
 *   12. Extension 干净构建回归测试
 *   13. Electron Smoke Runner 级失败测试（8 场景）
 *   14. Sentinel 路径安全测试（路径穿越/symlink/外部路径）
 *   15. Chrome Extension Smoke 反例测试（popup.js 损坏/缺失/SW 不匹配/Chrome 提前退出）
 *
 * 任一失败，verify:quick 失败。不使用假绿。S0 模式禁止跳过 Electron smoke。
 */
import { fileURLToPath } from 'node:url';
import { runCmd, truncateOutput } from './lib/run-cmd.mjs';
import { banner, step } from './lib/not-implemented.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));

async function runStep(name, cmd, args, opts) {
  const r = await runCmd(cmd, args, { cwd: root, ...opts });
  const ok = r.code === 0;
  step(name, ok, `exit=${r.code}`);
  if (!ok) {
    const out = (r.stdout || '') + (r.stderr || '');
    if (out.trim()) {
      console.log(truncateOutput(out, 120));
    }
  }
  return ok;
}

banner('verify:quick (G-Q, M0-01)');

let allOk = true;

// 1. 依赖方向
allOk = (await runStep('dep-direction check', 'node', ['scripts/check-deps.mjs'])) && allOk;

// 2. Prettier
allOk =
  (await runStep('prettier --check', 'node', [
    'node_modules/prettier/bin/prettier.cjs',
    '--check',
    '--no-error-on-unmatched-pattern',
    'apps',
    'packages',
    'scripts',
    '*.ts',
    '*.json',
    '*.md',
  ])) && allOk;

// 3. TypeScript 类型检查
allOk = (await runStep('tsc -b (project references)', 'node_modules/.bin/tsc', ['-b'])) && allOk;

// 4. Turbo Build（含 esbuild 打包）
allOk =
  (await runStep('turbo build (all workspaces)', 'node_modules/.bin/turbo', ['run', 'build'])) &&
  allOk;

// 5. Extension manifest + 产物引用完整性
allOk =
  (await runStep('manifest parse + artifact test', 'node', [
    'apps/browser-extension/scripts/manifest-parse.test.mjs',
  ])) && allOk;

// 6. Desktop 安全配置静态检查
allOk =
  (await runStep('desktop security config check', 'node', [
    'scripts/verify/desktop-security-check.mjs',
  ])) && allOk;

// 7. Desktop 产物完整性检查
allOk =
  (await runStep('artifact integrity check', 'node', [
    'scripts/verify/artifact-integrity-check.mjs',
  ])) && allOk;

// 8. Electron Packaged Ready smoke（正向 Ready 证据，S0 禁止跳过）
allOk =
  (await runStep('electron packaged ready smoke', 'node', ['scripts/verify/electron-smoke.mjs'], {
    timeout: 120000,
  })) && allOk;

// 9. Electron smoke 失败路径测试
allOk =
  (await runStep(
    'electron smoke failure tests',
    'node',
    ['--test', 'scripts/verify/electron-smoke-failures.test.mjs'],
    {
      timeout: 120000,
    },
  )) && allOk;

// 10. Native Host 协议测试
allOk =
  (await runStep('native-host protocol test', 'node', [
    '--test',
    'apps/native-host/scripts/native-host.test.mjs',
  ])) && allOk;

// 11. Extension Chrome 加载 smoke
allOk =
  (await runStep('extension chrome smoke', 'node', ['scripts/verify/extension-chrome-smoke.mjs'], {
    timeout: 90000,
  })) && allOk;

// 12. Extension 干净构建回归测试（删除 background.ts 后构建必须失败）
allOk =
  (await runStep(
    'extension clean build regression',
    'node',
    ['--test', 'scripts/verify/extension-clean-build.test.mjs'],
    {
      timeout: 120000,
    },
  )) && allOk;

// 13. Electron Smoke Runner 级失败测试（直接跑 electron-smoke.mjs，8 场景）
allOk =
  (await runStep(
    'electron smoke runner tests',
    'node',
    ['--test', 'scripts/verify/electron-smoke-runner.test.mjs'],
    {
      timeout: 300000,
    },
  )) && allOk;

// 14. Sentinel 路径安全测试
allOk =
  (await runStep(
    'sentinel path security tests',
    'node',
    ['--test', 'scripts/verify/sentinel-path-security.test.mjs'],
    {
      timeout: 120000,
    },
  )) && allOk;

// 15. Chrome Extension Smoke 反例测试（popup.js 损坏/缺失/SW 不匹配/Chrome 提前退出）
allOk =
  (await runStep(
    'extension chrome smoke failure tests',
    'node',
    ['--test', 'scripts/verify/extension-chrome-smoke-failures.test.mjs'],
    {
      timeout: 900000,
    },
  )) && allOk;

console.log('==============================================================');
if (allOk) {
  console.log('verify:quick: PASS');
  process.exit(0);
} else {
  console.log('verify:quick: FAIL');
  process.exit(1);
}
