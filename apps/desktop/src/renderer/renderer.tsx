/**
 * DesignWan Renderer 入口（Sandboxed，无 Node/DB/Keychain 能力）。
 *
 * 使用 React 18 createRoot 渲染。通过 Preload 暴露的窄 Interface 与 Main 通信。
 * 后续卡在此消费 @designwan/ui 的 View Model 与 React 组件。
 */
import { createRoot } from 'react-dom/client';

declare global {
  interface Window {
    designwan: {
      negotiate: () => Promise<{
        result:
          | { ok: true; value: { protocol: string; app: string } }
          | { ok: false; error: { message: string } };
      }>;
      ping: () => Promise<unknown>;
    };
  }
}

type NegotiateResult =
  | { ok: true; value: { protocol: string; app: string } }
  | { ok: false; error: { message: string } };

function App({ result }: { result: NegotiateResult | null }) {
  if (result === null) {
    return <p>Loading DesignWan skeleton…</p>;
  }
  if (!result.ok) {
    return <p style={{ color: 'red' }}>Error: {result.error.message}</p>;
  }
  const v = result.value;
  return (
    <div>
      <h1>DesignWan skeleton</h1>
      <p>Protocol: {v.protocol}</p>
      <p>App: {v.app}</p>
      <p>Renderer sandboxed. No Node/DB/Keychain access.</p>
    </div>
  );
}

async function bootstrap(): Promise<void> {
  const rootEl = document.getElementById('root');
  if (!rootEl) {
    throw new Error('renderer: #root element not found');
  }
  const root = createRoot(rootEl);
  root.render(<App result={null} />);
  try {
    const res = await window.designwan.negotiate();
    root.render(<App result={res.result} />);
  } catch (e) {
    root.render(<App result={{ ok: false, error: { message: (e as Error).message } }} />);
  }
}

void bootstrap();
