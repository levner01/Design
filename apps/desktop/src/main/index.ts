/**
 * DesignWan Electron Main 进程入口（Composition Root 骨架）。
 *
 * 安全基线（STACK_AND_ARCHITECTURE.md §3.2）：
 * - Renderer: sandbox=true, contextIsolation=true, nodeIntegration=false
 * - Preload 只暴露窄 Interface，不透传 ipcRenderer
 * - 严格 CSP，禁止远程脚本/inline 脚本
 * - 禁止任意导航与新窗口
 * - 每个业务动作一个具体 IPC channel，禁止通用 invoke(channel, args)
 *
 * M0-01 阶段仅注册 negotiate / ping 两个最小 channel，
 * 真实业务 IPC 由后续卡按 IpcRequest Envelope 注册。
 */
import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'node:path';
import { PROTOCOL_VERSION, APP_VERSION } from '@designwan/contracts';

// 窄 IPC channel 常量；每个业务动作一个具体 channel
const IPC_CHANNEL_NEGOTIATE = 'designwan:negotiate';
const IPC_CHANNEL_PING = 'designwan:ping';

const isDev = process.env.NODE_ENV === 'development';

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'DesignWan',
    show: false,
    webPreferences: {
      // 信任边界：Renderer 不可信
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webviewTag: false,
      // Preload 路径：与 main 编译产物同级
      preload: path.join(import.meta.dirname, '..', 'preload', 'index.js'),
    },
  });

  // 严格 CSP：只允许本地资源；禁止远程脚本/inline 脚本/object/embed
  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const csp = [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
    ].join('; ');
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    });
  });

  // 禁止任意导航（只允许初始 load）与新窗口
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  if (isDev) {
    void win.loadURL('http://localhost:5173');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    void win.loadFile(path.join(import.meta.dirname, '..', '..', 'renderer', 'index.html'));
  }

  win.once('ready-to-show', () => win.show());
  return win;
}

app.whenReady().then(() => {
  // 窄 IPC 注册：每个动作一个具体 handler，参数由 Main 重新校验
  ipcMain.handle(IPC_CHANNEL_NEGOTIATE, () => ({
    result: { ok: true, value: { protocol: PROTOCOL_VERSION, app: APP_VERSION } },
    handledWith: { protocol: PROTOCOL_VERSION, app: APP_VERSION },
  }));
  ipcMain.handle(IPC_CHANNEL_PING, () => ({
    result: { ok: true, value: { status: 'ok' as const, timestamp: Date.now() } },
    handledWith: { protocol: PROTOCOL_VERSION, app: APP_VERSION },
  }));

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
