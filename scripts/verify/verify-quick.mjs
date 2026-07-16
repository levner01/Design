#!/usr/bin/env node
/**
 * DesignWan verify:quick
 *
 * 任务卡 GLM-M0-01 §6：Format/Lint/Typecheck/依赖方向/单测/Build 烟测。
 *
 * 真实执行的子门：
 *   1. 依赖方向检查（scripts/check-deps.mjs）
 *   2. Prettier 格式检查
 *   3. TypeScript Project References 构建（tsc -b）
 *   4. Turbo build（所有 workspace 包）
 *   5. Browser Extension manifest 解析
 *   6. Desktop 安全配置静态检查
 *
 * 任一失败，verify:quick 失败。不使用假绿。
 */
import { fileURLToPath } from 'node:url';
import { runCmd, truncateOutput } from './lib/run-cmd.mjs';
import { banner, step } from './lib/not-implemented.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));

async function runStep(name, cmd, args) {
  const r = await runCmd(cmd, args, { cwd: root });
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

allOk = (await runStep('dep-direction check', 'node', ['scripts/check-deps.mjs'])) && allOk;
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
allOk = (await runStep('tsc -b (project references)', 'node_modules/.bin/tsc', ['-b'])) && allOk;
allOk =
  (await runStep('turbo build (all workspaces)', 'node_modules/.bin/turbo', ['run', 'build'])) &&
  allOk;
allOk =
  (await runStep('manifest parse test', 'node', [
    'apps/browser-extension/scripts/manifest-parse.test.mjs',
  ])) && allOk;
allOk =
  (await runStep('desktop security config check', 'node', [
    'scripts/verify/desktop-security-check.mjs',
  ])) && allOk;

console.log('==============================================================');
if (allOk) {
  console.log('verify:quick: PASS');
  process.exit(0);
} else {
  console.log('verify:quick: FAIL');
  process.exit(1);
}
