/**
 * DesignWan Extension Popup 入口（骨架）。
 * M0-01 阶段只显示版本；真实采集 UI 由 GLM-M1-02 实现。
 *
 * __DESIGNWAN_POPUP_READY__ 是仅用于测试的 Ready 标记（第四次复验 §5.4.2）：
 * Chrome Extension Smoke 通过 CDP 验证 popup.js 实际执行。
 * 生产环境无副作用，只是一个布尔值。
 */
import { PROTOCOL_VERSION, APP_VERSION } from '@designwan/contracts';

const root = document.getElementById('root');
if (root) {
  root.innerHTML += [`<p>Protocol: ${PROTOCOL_VERSION}</p>`, `<p>App: ${APP_VERSION}</p>`].join('');
}

// 测试专用 Ready 标记：证明 popup.js 实际执行
(globalThis as unknown as Record<string, unknown>).__DESIGNWAN_POPUP_READY__ = true;
