/**
 * DesignWan 业务模块入口骨架。
 *
 * 后续卡将在此聚合以下子模块的 Public Interface：
 * - Capture
 * - Assets
 * - Projects
 * - Decisions
 * - Memory
 * - Retrieval
 * - Graph
 * - Deletion
 *
 * 严格约束：
 * - 业务 Module 不得 Import Electron、SQLite Driver、sqlite-vec、Provider SDK、
 *   HTTP Server 或 Chrome Extension 类型。
 * - 业务 Module 只通过 @designwan/contracts 暴露的窄 Interface 与外界交互。
 * - Module 不能 Import @designwan/platform 或 @designwan/ui 的实现细节。
 */
export const MODULES_VERSION = '0.0.0' as const;

/**
 * 业务模块注册表骨架。
 * Composition Root（Desktop Main）将注入 Platform Adapter 实现这些 Interface。
 */
export interface ModuleRegistry {
  /** 模块命名空间，例如 'capture' / 'assets' */
  readonly namespace: string;
  /** 模块版本 */
  readonly version: string;
}
