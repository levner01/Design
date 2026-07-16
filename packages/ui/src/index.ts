/**
 * DesignWan UI 共享层入口。
 *
 * M0-01 阶段仅导出 View Model 类型与 Design Token；
 * 真实 React 组件由后续卡填充，由 apps/desktop/src/renderer 消费。
 *
 * 约束：
 * - UI 包不直接 Import Electron、Node fs、SQLite、Keychain。
 * - UI 包不 Import @designwan/modules 或 @designwan/platform 实现细节。
 */
export * from './tokens.js';
export * from './view-models.js';
