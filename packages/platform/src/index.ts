/**
 * DesignWan 平台层入口骨架。
 *
 * 后续卡将在此聚合以下 Adapter 的 Public Interface：
 * - LocalStore (SQLite Adapter + Migrations + health)
 * - AssetVault (Encrypted file Adapter)
 * - LocalVectorIndex (sqlite-vec / Exact Adapter)
 * - KeyProtector (safeStorage + OS Keychain / DPAPI / Secret Service)
 * - AI Gateway (Local / BYOK / Managed Stateless Adapters)
 * - Control Plane (Optional Supabase，仅元数据)
 * - Local Bridge (Loopback transfer protocol)
 * - Telemetry (Local-first, redacted)
 *
 * 严格约束：
 * - Platform Adapter 不得 Import @designwan/modules 业务实现。
 * - Platform Adapter 不得 Import @designwan/ui。
 * - 业务 Module 通过 Interface 调用 Platform；具体 Adapter 在 Desktop Main Composition Root 注入。
 */
export const PLATFORM_VERSION = '0.0.0' as const;

/**
 * 平台 Adapter 注册表骨架。
 * Composition Root（Desktop Main）将构造具体 Adapter 并注入到业务 Module。
 */
export interface PlatformAdapterRegistry {
  /** 平台命名空间，例如 'local-store' / 'asset-vault' */
  readonly namespace: string;
  /** Adapter 版本 */
  readonly version: string;
}
