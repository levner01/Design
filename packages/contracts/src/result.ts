/**
 * 业务结果类型工具。
 * IPC 与 Module 公开 Interface 统一返回 Result，避免抛出系统堆栈。
 */
export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E> = Ok<T> | Err<E>;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = <E>(error: E): Err<E> => ({ ok: false, error });

/**
 * 业务错误码枚举骨架。
 * 真实错误码由各业务 Module 在后续卡中扩展；当前仅建立命名空间。
 */
export type ErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'SCHEMA_INVALID'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'UNAVAILABLE'
  | 'INTERNAL';

export interface BusinessError {
  code: ErrorCode;
  /** 用户可见的脱敏消息；不得包含路径、SQL、Token、堆栈 */
  message: string;
  /** 不可逆的请求/追踪 ID，便于本地审计日志关联 */
  traceId?: string;
}
