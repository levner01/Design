/**
 * DesignWan Managed Stateless AI Gateway 空骨架。
 *
 * 硬约束（HANDOFF_PROTOCOL.md §1 / STACK_AND_ARCHITECTURE.md §9 / DATA_MODEL.md §11）：
 * - Request/Response Body 不进入数据库、对象存储、日志、Trace Attribute、Error Tracker 或死信队列。
 * - 只记录计费元数据、Route/版本、Token/图片计数、费用、状态/错误类别与不可逆请求摘要。
 * - 重试必须在内存短生命周期内完成；不能把正文放到云 Queue。
 * - Provider 自身保留/训练政策需逐 Route 展示；"Gateway 无状态"不代表下游 Provider 无保留。
 * - 不得反向依赖业务模块（@designwan/modules / @designwan/platform 业务实现）。
 *
 * M0-01 阶段：不启动 HTTP 服务，仅声明空骨架与契约文档。
 * 真实 Route 实现由 GLM-M2-03 完成。
 */

export const GATEWAY_VERSION = '0.0.0' as const;

export interface GatewayRuntimeInfo {
  readonly version: typeof GATEWAY_VERSION;
  readonly startedAt: number;
  /** 永远为 false 的占位：真实可服务状态由 GLM-M2-03 实现 */
  readonly servingRequests: false;
}

export function describeRuntime(): GatewayRuntimeInfo {
  return {
    version: GATEWAY_VERSION,
    startedAt: Date.now(),
    servingRequests: false,
  };
}

// 显式不在此启动任何 HTTP / WebSocket 服务器。
// 防止 M0-01 误把空骨架当成 Managed Route 事实源。
if (import.meta.url === `file://${process.argv[1]}`) {
  const info = describeRuntime();
  process.stdout.write(
    JSON.stringify({
      event: 'gateway.skeleton.booted',
      version: info.version,
      servingRequests: info.servingRequests,
      note: 'Managed Gateway is skeleton-only in M0-01. No business content is accepted or persisted.',
    }) + '\n',
  );
}
