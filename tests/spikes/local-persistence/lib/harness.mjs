/**
 * M0-02 本地持久化 Spike — 测试 Harness
 *
 * 提供统一的测试运行器：
 *   - 注册 test case
 *   - assert / equal / reject
 *   - 捕获异常并附 Reason Code
 *   - 输出结构化 JSON 报告（保存到 tests/spikes/local-persistence/run/）
 *   - exit 0 / 1 严格区分
 *
 * 设计原则：
 *   1. 不允许"假绿"——任何未捕获异常都视为失败，exit 1
 *   2. Reason Code 必须精确——不允许"unknown failure"
 *   3. 失败可追溯——保存完整 stack、输入参数、环境快照
 *   4. 不依赖外部断言库——避免 test 框架自身引入风险
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { failure, success, ReasonCode } from './reason-codes.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUN_DIR = join(__dirname, '..', 'run');

/**
 * @typedef {Object} TestResult
 * @property {string} name
 * @property {boolean} ok
 * @property {string} [reasonCode]
 * @property {string} [message]
 * @property {number} [durationMs]
 * @property {object} [context]
 * @property {string} [stack]
 */

/**
 * @typedef {Object} HarnessReport
 * @property {string} stage
 * @property {string} startedAt
 * @property {string} finishedAt
 * @property {number} totalDurationMs
 * @property {{passed: number, failed: number, total: number}} summary
 * @property {TestResult[]} tests
 * @property {object} environment
 */

export class Harness {
  /**
   * @param {string} stage - 阶段标识（如 '02-a-candidate-harness'）
   * @param {object} [options]
   * @param {object} [options.environment] - 由 env.mjs 的 probeAll() 返回的环境快照
   * @param {string} [options.reportName] - 报告文件名（不含扩展名）
   */
  constructor(stage, options = {}) {
    this.stage = stage;
    this.environment = options.environment ?? {};
    this.reportName = options.reportName ?? stage;
    /** @type {TestResult[]} */
    this.tests = [];
    this.startedAt = new Date().toISOString();
  }

  /**
   * 运行单个测试用例。任何 throw 视为失败，附 stack。
   * @param {string} name
   * @param {() => void | Promise<void>} fn
   * @param {object} [context] - 附加上下文（fixture path、参数等）
   * @returns {Promise<TestResult>}
   */
  async run(name, fn, context = {}) {
    const start = Date.now();
    /** @type {TestResult} */
    const result = { name, ok: false, context };
    try {
      await fn();
      result.ok = true;
      result.durationMs = Date.now() - start;
    } catch (err) {
      result.ok = false;
      result.durationMs = Date.now() - start;
      // 如果错误对象已经携带 reasonCode（来自我们的 failure()），使用之；否则默认 HARNESS_MISCONFIGURED
      result.reasonCode = err?.reasonCode ?? ReasonCode.HARNESS_MISCONFIGURED;
      result.message = err?.message ?? String(err);
      result.stack = err?.stack;
    }
    this.tests.push(result);
    return result;
  }

  /**
   * 同步断言。失败抛出携带 Reason Code 的 Error。
   * @param {boolean} condition
   * @param {string} message
   * @param {string} [reasonCode] - 默认 HARNESS_MISCONFIGURED
   */
  assert(condition, message, reasonCode = ReasonCode.HARNESS_MISCONFIGURED) {
    if (!condition) {
      const err = new Error(message);
      err.reasonCode = reasonCode;
      throw err;
    }
  }

  /**
   * 等值断言。
   * @param {any} actual
   * @param {any} expected
   * @param {string} message
   * @param {string} [reasonCode]
   */
  equal(actual, expected, message, reasonCode = ReasonCode.HARNESS_MISCONFIGURED) {
    if (actual !== expected) {
      const err = new Error(`${message} (actual=${JSON.stringify(actual)}, expected=${JSON.stringify(expected)})`);
      err.reasonCode = reasonCode;
      throw err;
    }
  }

  /**
   * 期望 fn 抛出异常，且（可选）异常消息包含子串。
   * 不抛异常 = 失败。
   * @param {() => void} fn
   * @param {string} message
   * @param {string} [expectedSubstring]
   * @param {string} [reasonCode]
   */
  expectThrow(fn, message, expectedSubstring, reasonCode = ReasonCode.HARNESS_MISCONFIGURED) {
    let threw = false;
    let err;
    try {
      fn();
    } catch (e) {
      threw = true;
      err = e;
    }
    if (!threw) {
      const e = new Error(`${message}: expected throw but none occurred`);
      e.reasonCode = reasonCode;
      throw e;
    }
    if (expectedSubstring && !String(err?.message ?? '').includes(expectedSubstring)) {
      const e = new Error(`${message}: thrown message "${err?.message}" does not contain "${expectedSubstring}"`);
      e.reasonCode = reasonCode;
      throw e;
    }
  }

  /**
   * 输出结构化 JSON 报告并返回 exit code。
   * @returns {{ report: HarnessReport, exitCode: number }}
   */
  finish() {
    const finishedAt = new Date().toISOString();
    const summary = {
      passed: this.tests.filter((t) => t.ok).length,
      failed: this.tests.filter((t) => !t.ok).length,
      total: this.tests.length,
    };
    const report = {
      stage: this.stage,
      startedAt: this.startedAt,
      finishedAt,
      totalDurationMs: Date.now() - new Date(this.startedAt).getTime(),
      summary,
      tests: this.tests,
      environment: this.environment,
    };
    mkdirSync(RUN_DIR, { recursive: true });
    const reportPath = join(RUN_DIR, `${this.reportName}.json`);
    writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
    const exitCode = summary.failed === 0 ? 0 : 1;
    return { report, exitCode, reportPath };
  }

  /**
   * 打印可读的总结到 stdout（CI 日志友好）。
   * @param {{ report: HarnessReport, exitCode: number, reportPath: string }} result
   */
  static printSummary(result) {
    const { report, exitCode, reportPath } = result;
    const lines = [
      '',
      `════════ ${report.stage} ════════`,
      `  PASS: ${report.summary.passed}/${report.summary.total}`,
      `  FAIL: ${report.summary.failed}/${report.summary.total}`,
      `  Duration: ${report.totalDurationMs}ms`,
      `  Report: ${reportPath}`,
      `  Exit: ${exitCode}`,
    ];
    for (const t of report.tests) {
      const tag = t.ok ? 'PASS' : 'FAIL';
      const rc = t.reasonCode ? ` [${t.reasonCode}]` : '';
      lines.push(`  [${tag}] ${t.name}${rc} (${t.durationMs}ms)`);
    }
    lines.push('═══════════════════════════');
    console.log(lines.join('\n'));
  }
}

/**
 * 便捷函数：创建 harness，运行一组测试，输出报告，退出进程。
 * @param {string} stage
 * @param {Array<[string, () => void | Promise<void>]>} cases
 * @param {object} [options]
 */
export async function runAll(stage, cases, options = {}) {
  const harness = new Harness(stage, options);
  for (const [name, fn] of cases) {
    await harness.run(name, fn, options.context ?? {});
  }
  const result = harness.finish();
  Harness.printSummary(result);
  process.exitCode = result.exitCode;
  return result;
}
