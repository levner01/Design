#!/usr/bin/env node
/**
 * DesignWan verify:desktop-security
 *
 * Gate G-DS（CODEX_ACCEPTANCE_MATRIX.md §2）：CSP/IPC/Preload/Key/导航/Secret。
 *
 * M0-01 阶段仅执行静态可校验的子集（scripts/verify/desktop-security-check.mjs）；
 * 完整运行时安全门（攻击测试、Key 生命周期、Bundle 扫描、双平台解锁录屏）由 GLM-M0-04 实现。
 *
 * 本脚本不假装通过；静态部分失败则 FAIL，静态部分通过则明确说明 M0-04 尚未完成运行时门。
 */
import { fileURLToPath } from 'node:url';
import { runCmd } from './lib/run-cmd.mjs';
import { banner, step, failNotImplemented } from './lib/not-implemented.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));

banner('verify:desktop-security (G-DS, M0-01 static subset)');

const r = await runCmd('node', ['scripts/verify/desktop-security-check.mjs'], { cwd: root });
const staticOk = r.code === 0;
step('static desktop security check', staticOk, `exit=${r.code}`);
if (r.stdout) console.log(r.stdout);
if (r.stderr) console.error(r.stderr);

if (!staticOk) {
  console.log('==============================================================');
  console.log('verify:desktop-security: FAIL (static subset failed)');
  process.exit(1);
}

// 静态子集通过；运行时门尚未实现
failNotImplemented({
  gateName: 'verify:desktop-security (runtime subset)',
  responsibleTask: 'GLM-M0-04 Electron 安全 IPC 与 Key Management',
  reason:
    'M0-01 仅完成静态配置检查。运行时门（XSS→Node、Prototype pollution、恶意 URL、' +
    'Key 生命周期、Bundle 扫描、双平台解锁录屏）由 GLM-M0-04 实现。',
  nextAction: '等待 GLM-M0-04 实现运行时安全门并产出完整证据包。',
});
