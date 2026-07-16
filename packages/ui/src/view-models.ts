/**
 * Renderer 使用的 View Model 骨架。
 * View Model 不携带绝对路径、密钥、SQLite 错误堆栈。
 */
import type { VersionNegotiation } from '@designwan/contracts/version';

export interface AppShellViewModel {
  appVersion: string;
  protocol: VersionNegotiation;
  /** 渲染状态：loading | ready | error */
  status: 'loading' | 'ready' | 'error';
  /** 用户可见的脱敏错误消息 */
  errorMessage?: string;
}
