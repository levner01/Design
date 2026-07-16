/**
 * 本地 Job / Outbox 契约骨架。
 *
 * 约束：
 * - SQLite Job 表提供至少一次执行语义；Handler 必须幂等。
 * - Job Payload 大字段进入本地加密 Vault，不直接存 SQLite。
 * - App 关闭时状态保持，下次启动恢复。
 *
 * 实际调度器由 GLM-M2-01 实现。
 */
export type JobStatus =
  'queued' | 'active' | 'retry_wait' | 'completed' | 'dead_letter' | 'cancelled';

export interface JobDescriptor<Payload> {
  /** Job 类型，例如 'import.batch.process' */
  jobType: string;
  /** 幂等键，含资源/输入/政策版本 */
  dedupeKey: string;
  /** 最小 Payload；大字段使用 Object Ref */
  payload: Payload;
  /** 优先级，数字越大越优先 */
  priority: number;
  /** 最大重试次数 */
  maxAttempts: number;
}

export interface JobHandle {
  readonly jobId: string;
  readonly status: JobStatus;
  readonly attempt: number;
  readonly availableAt: number;
  /** 租约 Owner（Worker ID） */
  leaseOwner?: string;
  leaseExpiresAt?: number;
  heartbeatAt?: number;
  cancelRequestedAt?: number;
  completedAt?: number;
  lastErrorCode?: string;
}
