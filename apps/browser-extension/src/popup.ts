/**
 * DesignWan Extension Popup 入口（骨架）。
 * M0-01 阶段只显示版本；真实采集 UI 由 GLM-M1-02 实现。
 */
import { PROTOCOL_VERSION, APP_VERSION } from '@designwan/contracts';

const root = document.getElementById('root');
if (root) {
  root.innerHTML += [`<p>Protocol: ${PROTOCOL_VERSION}</p>`, `<p>App: ${APP_VERSION}</p>`].join('');
}
