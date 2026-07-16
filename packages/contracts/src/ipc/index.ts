/**
 * IPC 契约骨架。
 *
 * 关键原则：
 * - Renderer 永远不直接调用通用 `ipcRenderer.invoke(channel, payload)`。
 * - 每个业务动作必须定义独立窄 Interface（如 capture.submit、asset.query）。
 * - Main 在收到请求时必须重新校验 Sender、Window、Schema、Actor、Scope、大小与幂等键。
 * - IPC 返回 View Model 或结果引用，不返回绝对路径、密钥、SQLite 错误堆栈。
 */
import type { Result, BusinessError } from '../result.js';
import type { VersionNegotiation } from '../version.js';

/**
 * IPC 请求 Envelope。
 * 所有 Preload → Main 的请求都包装为 Envelope；Main 校验后路由到具体 Handler。
 */
export interface IpcRequest<Payload> {
  /** 窄动作命名空间，例如 'capture.submit'；禁止 '*' 或通用 invoke */
  action: string;
  /** Schema 版本，用于跨版本协商 */
  schemaVersion: string;
  /** Actor Session ID，由 Main 在握手时签发 */
  actorSessionId: string;
  /** 当前请求的 Project/Client/Workspace Scope；Renderer 输入不可信，Main 必须复核 */
  scope?: IpcScope;
  /** 调用方提供的幂等键，Extension 重放与重试必须复用同一 Key */
  idempotencyKey?: string;
  /** 业务 Payload */
  payload: Payload;
}

export interface IpcScope {
  workspaceId: string;
  projectId?: string;
  clientId?: string;
}

export interface IpcResponse<T> {
  result: Result<T, BusinessError>;
  /** Main 处理该请求时使用的协议版本 */
  handledWith: VersionNegotiation;
}

/**
 * Preload 暴露给 Renderer 的窄 Interface 容器。
 * 每个属性是一个具体业务动作的调用函数，不接受任意 channel。
 */
export interface PreloadBridge {
  /** 协议版本协商，Renderer 启动时调用一次 */
  negotiate(): Promise<IpcResponse<VersionNegotiation>>;
  /** 健康检查 */
  ping(): Promise<IpcResponse<{ status: 'ok'; timestamp: number }>>;
}
