/**
 * DesignWan 共享契约层入口。
 *
 * 仅暴露版本化、参数校验后的窄 Interface 类型与常量。
 * 不得在此处导入 Electron、Node fs、SQLite 或任何业务 Module 实体。
 */
export * from './version.js';
export * from './result.js';
export * from './ipc/index.js';
export * from './native-messaging/index.js';
export * from './bridge/index.js';
export * from './jobs/index.js';
export * from './ai/index.js';
