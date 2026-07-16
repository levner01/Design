/**
 * DesignWan 依赖方向规则。
 *
 * 规则来源：STACK_AND_ARCHITECTURE.md §6 与 HANDOFF_PROTOCOL.md §1。
 * 业务 Module 不 Import Electron、SQLite Driver、sqlite-vec、Provider SDK、
 * HTTP Server 或 Chrome Extension 类型；业务 Module 只通过 contracts 暴露的窄 Interface 与外界交互。
 *
 * 每个键是被检查的 workspace 包名（package.json#name），
 * 值是允许 import 的 @designwan/* 包名集合（'*' 表示任意，空数组表示禁止任何内部依赖）。
 */
export const DEP_RULES = Object.freeze({
  // 顶层共享包
  '@designwan/contracts': [],
  '@designwan/modules': ['@designwan/contracts'],
  '@designwan/platform': ['@designwan/contracts'],
  '@designwan/testing': ['@designwan/contracts'],
  '@designwan/ui': ['@designwan/contracts'],

  // 应用包
  '@designwan/desktop': [
    '@designwan/contracts',
    '@designwan/modules',
    '@designwan/platform',
    '@designwan/ui',
  ],
  '@designwan/browser-extension': ['@designwan/contracts'],
  '@designwan/native-host': ['@designwan/contracts'],
  // Managed Gateway 不得反向依赖业务模块
  '@designwan/managed-gateway': [],
});

/**
 * 子目录级别规则：某些包内部的子目录只能 import 特定子集。
 * 用于防止 desktop/renderer 误 import main、preload 误 import main 等。
 */
export const SUBPATH_RULES = Object.freeze({
  // Renderer 只能 import contracts 与 ui，不能 import modules/platform
  'apps/desktop/src/renderer': ['@designwan/contracts', '@designwan/ui'],
  // Preload 只能 import contracts/ipc（type-only）
  'apps/desktop/src/preload': ['@designwan/contracts'],
  // Main 可以 import contracts/modules/platform
  'apps/desktop/src/main': ['@designwan/contracts', '@designwan/modules', '@designwan/platform'],
});

export const DESIGNWAN_PKG_PREFIX = '@designwan/';
