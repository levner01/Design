/**
 * DesignWan Renderer 入口（Sandboxed，无 Node/DB/Keychain 能力）。
 *
 * M0-01 阶段只调用 Preload 暴露的 negotiate() 显示协议版本。
 * 后续卡在此消费 @designwan/ui 的 View Model 与 React 组件。
 */
import type { PreloadBridge } from '@designwan/contracts/ipc';

declare global {
  interface Window {
    designwan: PreloadBridge;
  }
}

async function bootstrap(): Promise<void> {
  const root = document.getElementById('root');
  if (!root) {
    throw new Error('renderer: #root element not found');
  }
  try {
    const res = await window.designwan.negotiate();
    if (!res.result.ok) {
      root.textContent = `Error: ${res.result.error.message}`;
      return;
    }
    const v = res.result.value;
    root.innerHTML = [
      '<h1>DesignWan skeleton</h1>',
      `<p>Protocol: ${v.protocol}</p>`,
      `<p>App: ${v.app}</p>`,
      '<p>Renderer sandboxed. No Node/DB/Keychain access.</p>',
    ].join('');
  } catch (e) {
    root.textContent = `Fatal: ${(e as Error).message}`;
  }
}

void bootstrap();
