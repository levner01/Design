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
import * as os from 'node:os';
import { realpathSync, lstatSync } from 'node:fs';
import { PROTOCOL_VERSION, APP_VERSION } from '@designwan/contracts';

// 窄 IPC channel 常量；每个业务动作一个具体 channel
const IPC_CHANNEL_NEGOTIATE = 'designwan:negotiate';
const IPC_CHANNEL_PING = 'designwan:ping';

const isDev = process.env.NODE_ENV === 'development';

/**
 * 校验并返回安全的 Sentinel 路径。
 *
 * 安全约束（第四次复验 §5.3）：
 * - 必须同时满足 DESIGNWAN_SMOKE_MODE === '1' 和 DESIGNWAN_SMOKE_SENTINEL
 * - 路径规范化后不得包含 `..`
 * - 父目录 realpath 必须位于 <tmpdir>/designwan-smoke-* 专用临时目录
 * - 禁止符号链接逃逸、任意绝对路径、覆盖已有非 Sentinel 文件
 *
 * 生产启动（SMOKE_MODE 未开启）完全不注册 Probe，不执行测试用 executeJavaScript。
 */
function resolveSmokeSentinelPath(): string | null {
  if (process.env.DESIGNWAN_SMOKE_MODE !== '1') return null;
  const raw = process.env.DESIGNWAN_SMOKE_SENTINEL;
  if (!raw) return null;

  // 规范化：resolve 后路径段不得为 `..`
  const resolved = path.resolve(raw);
  const segments = resolved.split(path.sep);
  if (segments.includes('..')) {
    console.error(`[smoke] sentinel path contains '..': ${raw}`);
    return null;
  }

  // 第五次整改 §B：sentinel 路径本身不得是 symlink。
  // 攻击场景：攻击者预置 symlink → 外部敏感文件，
  //   - App 用 wx 写入虽因 EEXIST 失败不会覆盖，但
  //   - 测试读取 sentinel 时会 follow symlink 读到外部文件内容，造成"假绿"。
  // 因此必须在 App 端拒绝 symlink 路径，不注册 Probe。
  try {
    const stat = lstatSync(resolved);
    if (stat.isSymbolicLink()) {
      console.error(
        `[smoke][SENTINEL_SYMLINK_REJECTED] sentinel path must not be a symlink: ${raw}`,
      );
      return null;
    }
  } catch (e) {
    const errno = (e as NodeJS.ErrnoException).code;
    if (errno !== 'ENOENT') {
      console.error(`[smoke] sentinel path lstat failed: ${(e as Error).message}`);
      return null;
    }
    // ENOENT：文件不存在，正常（App 会用 wx flag 创建）
  }

  // 父目录 realpath 必须位于 <tmpdir>/designwan-smoke-* 专用临时目录
  // 注意：macOS 上 os.tmpdir() 返回 /var/...，但 realpathSync 解析为 /private/var/...
  // 需要对 tmpdir 也做 realpath，确保前缀比较一致
  const parent = path.dirname(resolved);
  let realTmpdir: string;
  try {
    realTmpdir = realpathSync(os.tmpdir());
  } catch (e) {
    console.error(`[smoke] tmpdir not accessible: ${os.tmpdir()} (${(e as Error).message})`);
    return null;
  }
  const expectedPrefix = path.join(realTmpdir, 'designwan-smoke-');
  let realParent: string;
  try {
    realParent = realpathSync(parent);
  } catch (e) {
    console.error(
      `[smoke] sentinel parent dir not accessible: ${parent} (${(e as Error).message})`,
    );
    return null;
  }
  if (!realParent.startsWith(expectedPrefix)) {
    console.error(`[smoke] sentinel parent must be under ${expectedPrefix}*, got ${realParent}`);
    return null;
  }

  // 文件名必须是 .json 后缀
  if (!resolved.endsWith('.json')) {
    console.error(`[smoke] sentinel path must end with .json: ${raw}`);
    return null;
  }

  return resolved;
}

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
      // Preload 路径：sandbox 模式必须用 CJS（.cjs），不能用 ESM import
      preload: path.join(import.meta.dirname, '..', 'preload', 'index.cjs'),
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
    void win.loadFile(path.join(import.meta.dirname, '..', 'renderer', 'index.html'));
  }

  win.once('ready-to-show', () => win.show());

  // 测试专用 Ready Sentinel（S0 验收正向 Ready 门）
  // 受 DESIGNWAN_SMOKE_MODE + DESIGNWAN_SMOKE_SENTINEL 双开关控制
  // 生产启动（SMOKE_MODE !== '1'）完全不注册 Probe
  const sentinelPath = resolveSmokeSentinelPath();
  if (sentinelPath) {
    let loadFailed = false;
    let sentinelWritten = false;

    const writeSentinel = async (payload: unknown) => {
      if (sentinelWritten) return;
      sentinelWritten = true;
      const { writeFile } = await import('node:fs/promises');
      // 独占创建：flag 'wx' 在文件已存在时报错，避免覆盖已有非 Sentinel 文件
      await writeFile(sentinelPath, JSON.stringify(payload), { flag: 'wx' });
    };

    // 主 frame 加载失败（HTML 缺失 / ERR_FILE_NOT_FOUND / 网络错误）→ sentinel.ok=false
    win.webContents.on(
      'did-fail-load',
      (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
        if (!isMainFrame || loadFailed) return;
        loadFailed = true;
        const payload = {
          ok: false,
          error: `did-fail-load: errorCode=${errorCode} ${errorDescription}`,
        };
        writeSentinel(payload)
          .then(() => {
            console.error(`[smoke] sentinel failed: ${payload.error}`);
            app.exit(1);
          })
          .catch((e) => {
            console.error(`[smoke] sentinel write failed: ${(e as Error).message}`);
            app.exit(1);
          });
      },
    );

    // did-finish-load 在错误页也会触发；如果 loadFailed，跳过 probe
    win.webContents.on('did-finish-load', async () => {
      if (loadFailed) return;
      try {
        const probe = await win.webContents.executeJavaScript(
          `(async () => {
            const readyState = document.readyState;
            const hasBridge = typeof window.designwan === 'object' && window.designwan !== null;
            if (!hasBridge) {
              return { ok: false, error: 'preload bridge missing', readyState };
            }
            const negotiateResult = await window.designwan.negotiate();
            return { ok: true, readyState, hasBridge: true, negotiate: negotiateResult };
          })()`,
        );
        await writeSentinel(probe);
        if (!probe.ok) {
          console.error(`[smoke] sentinel failed: ${probe.error}`);
          app.exit(1);
        }
      } catch (e) {
        await writeSentinel({ ok: false, error: (e as Error).message }).catch(() => {});
        app.exit(1);
      }
    });
  }

  return win;
}

app.whenReady().then(() => {
  // 窄 IPC 注册：每个动作一个具体 handler，参数由 Main 重新校验
  // 测试故障注入：SMOKE_MODE=1 且 DESIGNWAN_TEST_NEGOTIATE_FAIL=1 时返回 ok:false
  // 生产模式（SMOKE_MODE !== '1'）不受影响，无法被环境变量注入故障
  const smokeMode = process.env.DESIGNWAN_SMOKE_MODE === '1';
  const negotiateFail = process.env.DESIGNWAN_TEST_NEGOTIATE_FAIL === '1';

  ipcMain.handle(IPC_CHANNEL_NEGOTIATE, () => {
    if (smokeMode && negotiateFail) {
      return {
        result: { ok: false as const, error: { message: 'injected test failure' } },
        handledWith: { protocol: PROTOCOL_VERSION, app: APP_VERSION },
      };
    }
    return {
      result: { ok: true as const, value: { protocol: PROTOCOL_VERSION, app: APP_VERSION } },
      handledWith: { protocol: PROTOCOL_VERSION, app: APP_VERSION },
    };
  });
  ipcMain.handle(IPC_CHANNEL_PING, () => ({
    result: { ok: true as const, value: { status: 'ok' as const, timestamp: Date.now() } },
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
