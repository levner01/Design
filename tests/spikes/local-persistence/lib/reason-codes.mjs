/**
 * M0-02 本地持久化 Spike — Reason Codes
 *
 * 每种失败输出唯一 Reason Code，由 02-B/02-C/02-D/02-E 测试与 verify:local-data.mjs 共享。
 * 不得使用模糊日志（"failed"、"error"）替代 Reason Code。
 *
 * Reason Code 命名规范：
 *   PERSISTENCE_SPIKE_<阶段>_<失败类型>
 */

export const ReasonCode = Object.freeze({
  // 02-A：候选与 Harness
  DRIVER_LOAD_FAILED: 'PERSISTENCE_SPIKE_DRIVER_LOAD_FAILED',
  LICENSE_BLOCKED: 'PERSISTENCE_SPIKE_LICENSE_BLOCKED',
  HARNESS_MISCONFIGURED: 'PERSISTENCE_SPIKE_HARNESS_MISCONFIGURED',

  // 02-B：加密 SQLite、Migration、Crash
  ENCRYPTION_DISABLED: 'PERSISTENCE_SPIKE_ENCRYPTION_DISABLED',
  WRONG_KEY_ACCEPTED: 'PERSISTENCE_SPIKE_WRONG_KEY_ACCEPTED',
  MIGRATION_CORRUPT: 'PERSISTENCE_SPIKE_MIGRATION_CORRUPT',
  CRASH_RECOVERY_FAILED: 'PERSISTENCE_SPIKE_CRASH_RECOVERY_FAILED',
  PLAINTEXT_LEAK: 'PERSISTENCE_SPIKE_PLAINTEXT_LEAK',

  // 02-C：FTS5、sqlite-vec、删除
  FTS_DELETE_FAILED: 'PERSISTENCE_SPIKE_FTS_DELETE_FAILED',
  VEC_LOAD_FAILED: 'PERSISTENCE_SPIKE_VEC_LOAD_FAILED',
  VEC_DELETE_FAILED: 'PERSISTENCE_SPIKE_VEC_DELETE_FAILED',

  // 02-E：Packaged App
  PACKAGED_LOAD_FAILED: 'PERSISTENCE_SPIKE_PACKAGED_LOAD_FAILED',

  // 02-D：性能门
  GUARDRAIL_PERF: 'PERSISTENCE_SPIKE_GUARDRAIL_PERF',
});

/**
 * 创建标准失败结果对象。
 * @param {string} code - ReasonCode 值
 * @param {string} message - 人类可读的失败原因
 * @param {object} [extra] - 附加上下文（exitCode、stage、fixture、platform 等）
 */
export function failure(code, message, extra = {}) {
  return {
    ok: false,
    reasonCode: code,
    message,
    ...extra,
  };
}

/**
 * 创建标准成功结果对象。
 * @param {string} stage - 测试阶段标识（02-a-candidate-load 等）
 * @param {object} [extra] - 附加上下文（version、options、metrics 等）
 */
export function success(stage, extra = {}) {
  return {
    ok: true,
    stage,
    ...extra,
  };
}

/**
 * Reason Code 白名单（用于负例精确断言）。
 * 负例测试注入故障后，断言失败结果的 reasonCode 必须命中白名单中的一项，
 * 否则视为未捕获异常（reason code mismatch）。
 */
export const ALL_REASON_CODES = Object.freeze(Object.values(ReasonCode));
