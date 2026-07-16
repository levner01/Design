/**
 * 协议版本常量。
 * 任何破坏性变更必须 bump Major；Preload/Main/Native Host/Extension 协商时使用。
 */
export const PROTOCOL_VERSION = '0.1.0' as const;

export const APP_VERSION = '0.0.0' as const;

export interface VersionNegotiation {
  /** 当前实现支持的协议版本 */
  protocol: typeof PROTOCOL_VERSION;
  /** 应用版本号 */
  app: typeof APP_VERSION;
}
