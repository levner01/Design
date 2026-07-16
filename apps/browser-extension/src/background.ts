/**
 * DesignWan Chrome MV3 Service Worker 入口（骨架）。
 *
 * M0-01 阶段只做最小生命周期日志；真实 Native Messaging 握手与离线队列由 GLM-M1-01/02 实现。
 *
 * 安全约束（STACK_AND_ARCHITECTURE.md §8）：
 * - 不在 IndexedDB 持久化敏感 Token/截图（除非本地加密可用）
 * - 不向任意 Origin 暴露 Native Host 句柄
 * - 离线队列最多 500 项 / 1GB / 7 天
 */
import { PROTOCOL_VERSION, APP_VERSION } from '@designwan/contracts';

const TAG = '[designwan:bg]';

// Chrome MV3 Service Worker 上下文；DOM 与 WebWorker lib 同时引入时 self 解析为 Window，
// 需要显式转换为 ServiceWorkerGlobalScope 才能访问 ExtendableEvent / clients 等 API。
const sw = self as unknown as ServiceWorkerGlobalScope;

sw.addEventListener('install', () => {
  console.log(TAG, 'service worker install', { protocol: PROTOCOL_VERSION, app: APP_VERSION });
});

sw.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(sw.clients.claim());
});

sw.addEventListener('message', (event: ExtendableMessageEvent) => {
  // 仅记录；真实 Native Messaging 走 chrome.runtime.connectNative
  console.log(TAG, 'message received', { origin: event.origin });
});

export {};
