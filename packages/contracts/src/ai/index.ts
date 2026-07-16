/**
 * AI Route 契约骨架。
 *
 * 三条 Route：
 * - local：OpenAI-compatible / Ollama，设备内或局域网。
 * - byok：用户本机直连 Provider，Key 由 KeyProtector 保存。
 * - managed：DesignWan 无状态 Gateway，只中转不持久化内容。
 *
 * $15 Soft / $20 Hard 只约束 managed Route；local/byok 不计入平台预算。
 *
 * 实际 Adapter 由 GLM-M2-03 实现。
 */
export type AiRouteType = 'local' | 'byok' | 'managed';

export type ExternalAiPolicy =
  'deny' | 'local_only' | 'byok_allowed' | 'managed_allowed' | 'explicit_route_allowlist';

export interface AiCapabilityRequest {
  /** 能力命名空间，例如 'vision.describe' / 'embedding.generate' */
  capability: string;
  /** 用户选择的 Route；Main 复核 Project Policy */
  route: AiRouteType;
  /** Schema 版本 */
  schemaVersion: string;
  /** 是否需要 Vision / Structured Output / Embedding 能力 */
  requiresVision: boolean;
  requiresStructuredOutput: boolean;
  requiresEmbedding: boolean;
}

export interface AiCapabilityResult {
  routeUsed: AiRouteType;
  /** 该 Route 的数据去向披露（用户可见） */
  dataDisclosure: string;
  /** 估算成本（仅 managed 计入平台预算） */
  estimatedCostUsd: number;
  /** 平台是否计费 */
  platformBillable: boolean;
  /** Trace ID，便于本地审计 */
  traceId: string;
}

export interface ManagedBudgetSnapshot {
  /** UTC 自然月 */
  month: string;
  /** Soft 阈值（USD） */
  softLimitUsd: number;
  /** Hard 阈值（USD） */
  hardLimitUsd: number;
  /** 已结算（USD） */
  settledUsd: number;
  /** 已预留（USD） */
  reservedUsd: number;
  /** 本 Run 最大授权成本（USD） */
  maximumAuthorizedRunCostUsd: number;
}
