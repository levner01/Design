/**
 * Chrome Native Messaging 契约骨架。
 *
 * 限制（来自 Chrome 官方）：
 * - 单条 stdio JSON 消息最大 1 MB。
 * - Native Manifest 必须显式声明 allowed_origins。
 * - 截图、整页 HTML、PDF 与批量文件不得 Base64 塞进 stdio。
 *
 * 本卡只定义协议形状；握手、Token、Nonce 由 GLM-M1-01 实现。
 */
import type { VersionNegotiation } from '../version.js';

export interface NativeMessagingEnvelope<Payload> {
  /** 协议版本 */
  v: string;
  /** 消息类型，例如 'hello' / 'session.request' / 'capture.submit' */
  type: string;
  /** 单调递增的序列号，用于乱序检测与重放保护 */
  seq: number;
  /** 会话 ID，握手后由 Host 签发 */
  sessionId?: string;
  /** 一次性 Nonce，防止重放 */
  nonce?: string;
  /** 业务 Payload（≤ 1 MB 序列化后） */
  payload: Payload;
}

export interface HelloPayload {
  extensionId: string;
  extensionVersion: string;
  requestedProtocol: string;
}

export interface HelloAckPayload {
  accepted: boolean;
  negotiated: VersionNegotiation;
  /** 拒绝原因（仅在 accepted=false 时） */
  reason?: string;
  /** 后续 Bridge 接入信息；具体 Token 由 Local Bridge 端点单独签发 */
  bridge?: {
    /** 仅 127.0.0.1，不绑定 0.0.0.0 */
    host: '127.0.0.1';
    /** 随机端口，不固定 */
    port: number;
  };
}
