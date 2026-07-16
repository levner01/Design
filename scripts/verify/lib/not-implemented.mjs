/**
 * 共享：未实现 verify 门的标准输出与退出。
 *
 * 原则（HANDOFF_PROTOCOL.md §7 / 任务卡 GLM-M0-01 §6）：
 * "未实现的门不得用永远返回成功的假脚本伪装通过。"
 *
 * 因此本模块输出明确的 NOT-IMPLEMENTED 原因与负责的任务卡，
 * 并以非零退出码结束，让 CI 真实失败。
 */

/**
 * @param {object} args
 * @param {string} args.gateName
 * @param {string} args.responsibleTask
 * @param {string} args.reason
 * @param {string} [args.nextAction]
 */
export function failNotImplemented({ gateName, responsibleTask, reason, nextAction }) {
  console.error(`==============================================================`);
  console.error(`DesignWan verify gate NOT IMPLEMENTED`);
  console.error(`--------------------------------------------------------------`);
  console.error(`Gate:           ${gateName}`);
  console.error(`Responsible:    ${responsibleTask}`);
  console.error(`Reason:         ${reason}`);
  if (nextAction) {
    console.error(`Next action:    ${nextAction}`);
  }
  console.error(`==============================================================`);
  console.error(`This gate intentionally fails. It must not be marked as PASS.`);
  process.exit(1);
}

/**
 * 打印当前 verify 门的开始 banner。
 */
export function banner(name) {
  console.log(`==============================================================`);
  console.log(`DesignWan verify: ${name}`);
  console.log(`--------------------------------------------------------------`);
  console.log(`started at ${new Date().toISOString()} on ${process.platform}`);
  console.log(`==============================================================`);
}

/**
 * 打印步骤结果。
 */
export function step(name, ok, detail = '') {
  const tag = ok ? 'PASS' : 'FAIL';
  console.log(`[${tag}] ${name}${detail ? ' — ' + detail : ''}`);
}
