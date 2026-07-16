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
 *   8. Electron 启动 smoke（无 ERR_FILE_NOT_FOUND / Preload SyntaxError）
 *   9. Native Host 协议测试（单 chunk / 拆 chunk / 连续帧 / 畸形）
 *
 * 任一失败，verify:quick 失败。不使用假绿。
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

// 8. Electron 启动 smoke（验证 preload CJS + renderer 加载 + 无 ERR_FILE_NOT_FOUND）
// 在无显示器的 CI 环境可设置 DISABLE_ELECTRON_SMOKE=1 跳过
if (process.env.DISABLE_ELECTRON_SMOKE === '1') {
  console.log('[SKIP] electron startup smoke (DISABLE_ELECTRON_SMOKE=1)');
} else {
  allOk =
    (await runStep('electron startup smoke', 'node', ['scripts/verify/electron-smoke.mjs'], {
      timeout: 15000,
    })) && allOk;
}

// 9. Native Host 协议测试
allOk =
  (await runStep('native-host protocol test', 'node', [
    '--test',
    'apps/native-host/scripts/native-host.test.mjs',
  ])) && allOk;

console.log('==============================================================');
if (allOk) {
  console.log('verify:quick: PASS');
  process.exit(0);
} else {
  console.log('verify:quick: FAIL');
  process.exit(1);
}
