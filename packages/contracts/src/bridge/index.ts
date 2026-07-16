/**
 * Loopback Local Bridge 契约骨架。
 *
 * 硬约束：
 * - 只绑定 127.0.0.1，绝不监听 0.0.0.0 / LAN / 公网。
 * - 端口随机，App 活动握手时按需启动，空闲超时关闭。
 * - Token 一次性、短时、绑定单一操作、Nonce、最大字节、过期时间。
 * - 严禁 Cookie、长期 Token、查询字符串 Secret。
 * - 失败日志不写文件内容/Token。
 *
 * 实际 HTTP 服务由 GLM-M1-01 实现；本卡仅定义类型。
 */
export interface BridgeTokenRequest {
  /** Extension ID，必须与 Native Manifest allowed_origins 一致 */
  extensionId: string;
  /** 会话 ID，由 Native Host 握手签发 */
  sessionId: string;
  /** 操作类型，例如 'capture.upload' */
  operation: string;
  /** 允许的 Content-Type */
  allowedContentTypes: readonly string[];
  /** 允许的最大字节数 */
  maxBytes: number;
  /** Token 过期时间（Unix ms） */
  expiresAt: number;
}

export interface BridgeToken {
  /** 一次性 Bearer Token，成功一次即失效 */
  token: string;
  /** 绑定目标 URL，仅 127.0.0.1 */
  uploadUrl: string;
  /** 允许的 Origin：chrome-extension://<approved-id> */
  allowedOrigin: string;
  /** 单次操作最大字节 */
  maxBytes: number;
  /** 过期时间 */
  expiresAt: number;
  /** Nonce，防重放 */
  nonce: string;
}

export interface BridgeUploadAck {
  accepted: boolean;
  /** 接收字节数 */
  bytes: number;
  /** 客户端提供的 SHA-256，Host 校验后回传 */
  sha256: string;
  /** 失败原因（仅在 accepted=false 时） */
  reason?: string;
}
