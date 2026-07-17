#!/usr/bin/env node
/**
 * Chrome Extension 真实加载 Smoke（第五次整改 §A）。
 *
 * 修复第四轮验收 §6.2 P1 的证据链缺口：
 * - Popup Target 先建立可观测能力（about:blank → attach → enable Page/Runtime/Log
 *   → 注册 exceptionThrown/consoleAPICalled/entryAdded），再导航到 Popup URL
 * - 附着 DesignWan 自身 Service Worker Target，采集 Runtime/Log 异常
 * - Log.entryAdded(error) 与 Runtime.consoleAPICalled(error) 纳入失败条件
 *   （第四轮实测 Popup Ready 后 console.error 仍 PASS，属假绿）
 * - CdpClient 每个 send 有独立 Deadline；Socket close/error Reject 全部 Pending
 * - 总 Smoke Deadline 覆盖完整 Popup + SW 验证流程
 * - 清理用 CDP Browser.close → 等端口关闭 → kill → 删 Profile
 *
 * 失败条件（任一命中 exit 1）：
 * - Popup 语法错误 / 脚本缺失 / Ready 标记缺失
 * - Popup Ready 后 console.error
 * - Popup 或 SW Runtime Exception
 * - SW error 级 Log
 * - CDP Socket 提前关闭 / CDP 请求超时
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, globSync } from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { banner, step } from './lib/not-implemented.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
// DESIGNWAN_EXT_DIST 供反例测试注入损坏产物；默认指向真实 dist。
const extDist = process.env.DESIGNWAN_EXT_DIST
  ? join(process.env.DESIGNWAN_EXT_DIST)
  : join(root, 'apps/browser-extension/dist');

// 总 Smoke Deadline：覆盖 Chrome 启动 + SW 发现 + Popup/SW 验证 + 事件收集
const OVERALL_DEADLINE_MS = 60000;
// Popup Ready 后额外等待时间，收集 console.error 等后续事件
const POST_READY_GRACE_MS = 2000;
// 单个 CDP 请求默认超时
const CDP_SEND_TIMEOUT_MS = 10000;

function findChrome() {
  const candidates = [];
  // Chrome for Testing 和 Chromium 支持 --load-extension；
  // Chrome stable 150+ 禁用了 --load-extension（extension_service.cc 报
  // "is not allowed in Google Chrome"），因此优先使用 Chrome for Testing。
  if (process.platform === 'darwin') {
    candidates.push(
      ...globSync(
        join(
          os.homedir(),
          'Library/Caches/ms-playwright/chromium-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
        ),
      ),
    );
    candidates.push('/Applications/Chromium.app/Contents/MacOS/Chromium');
    candidates.push('/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary');
    candidates.push('/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta');
    candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  } else if (process.platform === 'win32') {
    candidates.push(
      ...globSync(
        join(
          os.homedir(),
          'AppData/Local/ms-playwright/chromium-*/chrome-win/Google Chrome for Testing.exe',
        ),
      ),
    );
    candidates.push('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
    candidates.push('C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe');
  } else {
    candidates.push(
      ...globSync(join(os.homedir(), '.cache/ms-playwright/chromium-*/chrome-linux/chrome')),
    );
    candidates.push('/usr/bin/google-chrome');
    candidates.push('/usr/bin/chromium');
    candidates.push('/usr/bin/chromium-browser');
  }
  for (const p of candidates) {
    if (p && existsSync(p)) return p;
  }
  return null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 找一个空闲 TCP 端口。
 */
function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

async function fetchJson(url) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

/**
 * 等待子进程退出，超时后 SIGKILL。
 */
function waitForExit(child, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try {
          child.kill('SIGKILL');
        } catch {
          // 已退出
        }
        resolve();
      }
    }, timeoutMs);
    child.on('exit', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve();
      }
    });
    if (child.exitCode !== null || child.signalCode !== null) {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve();
      }
    }
  });
}

/**
 * CDP WebSocket 客户端（第五次整改 §A.5）。
 *
 * 设计要点：
 * - 每个 send 有独立 Deadline（默认 10s），超时后 reject 该请求
 * - Socket close/error 时 reject 全部 pending 请求，清空 pending Map
 * - 按 sessionId 收集 Runtime.exceptionThrown / Runtime.consoleAPICalled(error)
 *   / Log.entryAdded(error)；sessionId=null 为 browser level
 */
class CdpClient {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.closed = false;
    this._closeCallbacks = [];
    // sessionId -> bucket；null 为 browser level
    this.buckets = new Map();
    this.buckets.set(null, this._newBucket('browser'));

    this._onMessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject, timer } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        clearTimeout(timer);
        if (msg.error) reject(new Error(`CDP error: ${JSON.stringify(msg.error)}`));
        else resolve(msg.result);
      } else if (msg.method) {
        this._handleEvent(msg.method, msg.params, msg.sessionId ?? null);
      }
    };

    this._onClose = () => {
      if (this.closed) return;
      this.closed = true;
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(new Error('CDP socket closed'));
      }
      this.pending.clear();
      for (const cb of this._closeCallbacks) {
        try {
          cb();
        } catch {
          // ignore
        }
      }
    };

    this.ws.addEventListener('message', this._onMessage);
    this.ws.addEventListener('close', this._onClose);
    this.ws.addEventListener('error', () => this._onClose());
  }

  _newBucket(name) {
    return { exceptions: [], consoleErrors: [], logErrors: [], name };
  }

  _getBucket(sessionId) {
    if (!this.buckets.has(sessionId)) {
      this.buckets.set(sessionId, this._newBucket(sessionId));
    }
    return this.buckets.get(sessionId);
  }

  /**
   * 按 session 收集事件。browser level（sessionId=null）也收集，
   * 用于捕获 SW 注册失败等 browser 级 Log。
   */
  _handleEvent(method, params, sessionId) {
    const bucket = this._getBucket(sessionId);
    if (method === 'Runtime.exceptionThrown') {
      bucket.exceptions.push(params);
    } else if (method === 'Runtime.consoleAPICalled') {
      // 只收集 error 级 console 调用（console.error）
      if (params.type === 'error') {
        bucket.consoleErrors.push(params);
      }
    } else if (method === 'Log.entryAdded') {
      // 只收集 error 级 Log entry
      if (params.entry && params.entry.level === 'error') {
        bucket.logErrors.push(params.entry);
      }
    }
  }

  static async connect(url, timeoutMs = 5000) {
    const ws = new WebSocket(url);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('WebSocket connect timeout')), timeoutMs);
      ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolve(new CdpClient(ws));
      });
      ws.addEventListener('error', (e) => {
        clearTimeout(timer);
        reject(new Error(`WebSocket error: ${e.message || 'unknown'}`));
      });
    });
  }

  /**
   * 发送 CDP 请求，带独立 Deadline。
   * Socket close 时 reject 全部 pending（由 _onClose 处理）。
   */
  send(method, params = {}, sessionId, timeoutMs = CDP_SEND_TIMEOUT_MS) {
    if (this.closed) {
      return Promise.reject(new Error('CDP socket already closed'));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP send timeout: ${method} (id=${id}, ${timeoutMs}ms)`));
        }
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      const msg = { id, method, params };
      if (sessionId) msg.sessionId = sessionId;
      try {
        this.ws.send(JSON.stringify(msg));
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error(`CDP send failed: ${e.message}`));
      }
    });
  }

  /**
   * 注册 Socket close 回调（用于主流程感知 CDP 断开）。
   */
  onClose(callback) {
    this._closeCallbacks.push(callback);
  }

  close() {
    try {
      this.ws.close();
    } catch {
      // 已关闭
    }
  }

  /**
   * 汇总某 session 的所有 error，含可读详情。
   */
  summarize(sessionId) {
    const bucket = this.buckets.get(sessionId);
    if (!bucket) return { exceptions: 0, consoleErrors: 0, logErrors: 0, details: [] };
    const details = [];
    for (const e of bucket.exceptions) {
      const text =
        e.exceptionDetails?.text ||
        e.exceptionDetails?.exception?.description ||
        JSON.stringify(e).slice(0, 200);
      details.push(`Runtime.exceptionThrown: ${text}`);
    }
    for (const e of bucket.consoleErrors) {
      const text = (e.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
      details.push(`Runtime.consoleAPICalled(error): ${text}`);
    }
    for (const e of bucket.logErrors) {
      details.push(`Log.entryAdded(error): ${e.text} [source=${e.source}]`);
    }
    return {
      exceptions: bucket.exceptions.length,
      consoleErrors: bucket.consoleErrors.length,
      logErrors: bucket.logErrors.length,
      details,
    };
  }
}

/**
 * 清理 Chrome：优先 CDP Browser.close → 等端口关闭 → kill → 删 Profile。
 * 不遗留 Chrome/Chromium 进程。
 */
async function cleanupChrome(browserClient, child, debugPort, userDataDir) {
  // 1. 优先 CDP Browser.close（优雅关闭所有 target 和进程）
  if (browserClient && !browserClient.closed) {
    try {
      await browserClient.send('Browser.close', {}, undefined, 5000);
    } catch {
      // Browser.close 可能因 socket 关闭而 reject，忽略
    }
    browserClient.close();
  }

  // 2. 等待调试端口关闭（最多 5s）
  for (let i = 0; i < 50; i++) {
    const resp = await fetchJson(`http://127.0.0.1:${debugPort}/json/version`);
    if (!resp) break;
    await sleep(100);
  }

  // 3. 必要时清理子进程
  try {
    child.kill('SIGTERM');
  } catch {
    // 已退出
  }
  await waitForExit(child, 3000);
  try {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
  } catch {
    // 已退出
  }

  // 4. 删除临时 Profile
  rmSync(userDataDir, { force: true, recursive: true });
}

async function main() {
  banner('extension-chrome-smoke (M0-01 R5)');

  const deadlineStart = Date.now();
  const isOverdue = () => Date.now() - deadlineStart > OVERALL_DEADLINE_MS;

  // DESIGNWAN_CHROME_BIN 供反例测试注入假 Chrome。
  const chromePath = process.env.DESIGNWAN_CHROME_BIN || findChrome();
  if (!chromePath) {
    step('find Chrome/Chromium', false, 'not found on system');
    console.error('\n[FAIL] Chrome/Chromium not found.');
    process.exit(1);
  }
  step('find Chrome/Chromium', true, chromePath);

  // 前置检查：dist 产物
  const requiredFiles = ['manifest.json', 'background.js', 'popup.html', 'popup.js'];
  for (const f of requiredFiles) {
    if (!existsSync(join(extDist, f))) {
      step(`dist/${f} exists`, false, 'MISSING');
      process.exit(1);
    }
  }
  step('extension dist artifacts exist', true);

  // 动态分配调试端口
  const DEBUG_PORT = await findFreePort();
  step('dynamic debug port allocated', true, String(DEBUG_PORT));

  const headless = process.env.HEADLESS === '1';
  const userDataDir = mkdtempSync(join(os.tmpdir(), 'designwan-chrome-'));
  const chromeArgs = [
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    // Chrome 150+ 对 unpacked 扩展强制 Content Verification，但 unpacked 扩展没有
    // Web Store 签名的 verified_contents.json，导致 reason:1 (NO_HASHES) 错误。
    // 禁用 ContentVerifier feature 让 unpacked 扩展正常加载。
    // 这不跳过测试验证本身（popup.js 执行、SW 身份、ready 标记仍被验证）。
    '--disable-features=ContentVerifier',
    `--user-data-dir=${userDataDir}`,
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--load-extension=${extDist}`,
    'about:blank',
  ];
  if (headless) {
    chromeArgs.unshift('--headless=new', '--no-sandbox', '--disable-dev-shm-usage');
  }

  const child = spawn(chromePath, chromeArgs, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  let stderr = '';
  let chromeExited = false;
  let chromeExitCode = null;
  child.stderr.on('data', (d) => {
    stderr += d.toString();
  });
  child.on('exit', (code) => {
    chromeExited = true;
    chromeExitCode = code;
  });

  let version = null;
  let targets = null;

  // ── 阶段 1：轮询 CDP 直到拿到 DesignWan SW target ──────────
  // macOS 上 Chrome 主进程会 fork 子进程后退出，这是正常行为，
  // 不应判为失败。只有 CDP 不可达才是真正的 Chrome 退出。
  let designwanExtensionId = null;
  let swTargetInfo = null;
  const DEBUG_SW = process.env.DEBUG_SW === '1';
  let lastTargetCount = -1;

  for (let i = 0; i < 60; i++) {
    if (isOverdue()) break;
    await sleep(500);
    version = await fetchJson(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
    if (!version) continue;
    targets = await fetchJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
    if (!targets) continue;

    if (DEBUG_SW && targets.length !== lastTargetCount) {
      lastTargetCount = targets.length;
      console.log(`[debug][${i * 0.5}s] targets=${targets.length}`);
      for (const t of targets) {
        console.log(`  - ${t.type} ${t.url}`);
      }
    }

    // 从 DesignWan service worker target URL 提取 Extension ID。
    // 必须验证 SW URL 指向 manifest 声明的 background.js，
    // 否则会误匹配 Chrome 内置扩展（如 Google Hangouts 的 thunk.js）。
    const swTargets = targets.filter(
      (t) => t.type === 'service-worker' || t.type === 'service_worker',
    );
    for (const t of swTargets) {
      const url = t.url || '';
      if (url.endsWith('/background.js')) {
        const match = url.match(/^chrome-extension:\/\/([a-z]+)\//);
        if (match) {
          designwanExtensionId = match[1];
          swTargetInfo = t;
          break;
        }
      }
    }
    if (designwanExtensionId) break;
  }

  step('CDP version reachable', version !== null, version ? version.Browser || '' : 'no response');
  // macOS 上 Chrome 主进程退出是正常的 fork 行为，不算提前退出
  const chromeReallyExited = chromeExited && version === null;
  step(
    'Chrome not exited early',
    !chromeReallyExited,
    chromeReallyExited
      ? `exit code=${chromeExitCode}`
      : chromeExited
        ? 'main process forked (normal on macOS)'
        : '',
  );

  if (!designwanExtensionId || !swTargetInfo) {
    step('find DesignWan service worker + extract extension ID', false, 'no SW target found');
    console.log('--- targets at failure ---');
    if (targets) {
      for (const t of targets) {
        console.log(`  - type=${t.type} url=${t.url}`);
      }
    } else {
      console.log('  (no targets fetched)');
    }
    if (stderr.trim()) {
      console.log('--- stderr (first 1000) ---');
      console.log(stderr.slice(0, 1000));
    }
    await cleanupChrome(null, child, DEBUG_PORT, userDataDir);
    console.log('extension-chrome-smoke: FAIL');
    process.exit(1);
  }
  step('DesignWan extension ID extracted from SW', true, designwanExtensionId);

  // 只接受该 Extension ID 的 Target
  const ownTargets = (targets || []).filter((t) =>
    (t.url || '').startsWith(`chrome-extension://${designwanExtensionId}/`),
  );
  step('DesignWan extension targets found', ownTargets.length > 0, `${ownTargets.length} targets`);

  // ── 阶段 2：建立 CDP 连接 + Popup 可观测 + SW 附着 ─────────
  let browserClient = null;
  let popupSessionId = null;
  let swSessionId = null;
  let popupReady = false;
  let cdpSocketClosed = false;
  let flowError = null;

  try {
    const browserWsUrl = version.webSocketDebuggerUrl;
    browserClient = await CdpClient.connect(browserWsUrl);

    // 感知 CDP Socket 提前关闭（§A.3 失败条件之一）
    browserClient.onClose(() => {
      cdpSocketClosed = true;
    });

    // browser-level 只支持 Target/Browser 等 browser 域命令；
    // Log/Runtime/Page 域必须在具体 target session 上启用。
    // SW 注册失败等 browser 级 error 通过 stderr 检查 + SW session Log 捕获。
    await browserClient.send('Target.setDiscoverTargets', { discover: true });

    // ── Popup Target：先建可观测能力，再导航 ──────────────────
    // 1. 创建 about:blank Target（不加载 popup，确保 attach 前无事件丢失）
    const createResult = await browserClient.send('Target.createTarget', {
      url: 'about:blank',
    });
    const popupTargetId = createResult.targetId;
    step('CDP Target.createTarget about:blank', true, popupTargetId);

    // 2. Attach Popup Target
    const popupAttach = await browserClient.send('Target.attachToTarget', {
      targetId: popupTargetId,
      flatten: true,
    });
    popupSessionId = popupAttach.sessionId;
    browserClient._getBucket(popupSessionId).name = 'popup';
    step('CDP attach popup target', true, popupSessionId);

    // 3. 启用 Page / Runtime / Log（注册事件在 CdpClient._handleEvent 自动处理）
    await browserClient.send('Page.enable', {}, popupSessionId);
    await browserClient.send('Runtime.enable', {}, popupSessionId);
    await browserClient.send('Log.enable', {}, popupSessionId);
    step('popup session: Page/Runtime/Log enabled', true);

    // ── 附着 DesignWan Service Worker Target ──────────────────
    // 通过 Target.attachToTarget 附着到 SW，采集 Runtime.exceptionThrown
    // / consoleAPICalled(error) / Log.entryAdded(error)
    let swAttached = false;
    // SW target 可能刚启动，attach 需要重试
    for (let i = 0; i < 10; i++) {
      if (isOverdue()) break;
      try {
        const swAttach = await browserClient.send(
          'Target.attachToTarget',
          { targetId: swTargetInfo.id, flatten: true },
          undefined,
          5000,
        );
        swSessionId = swAttach.sessionId;
        browserClient._getBucket(swSessionId).name = 'service-worker';
        await browserClient.send('Runtime.enable', {}, swSessionId);
        await browserClient.send('Log.enable', {}, swSessionId);
        swAttached = true;
        step('CDP attach DesignWan SW target + Runtime/Log enabled', true, swSessionId);
        break;
      } catch (e) {
        if (i < 9) {
          await sleep(300);
        } else {
          step('CDP attach DesignWan SW target', false, e.message);
        }
      }
    }

    // ── 导航到 Popup URL（可观测能力已就绪）──────────────────
    const popupUrl = `chrome-extension://${designwanExtensionId}/popup.html`;
    try {
      const navResult = await browserClient.send(
        'Page.navigate',
        { url: popupUrl },
        popupSessionId,
      );
      const navError = navResult?.errorText;
      step(
        'CDP Page.navigate popup.html',
        !navError,
        navError ? `errorText=${navError}` : popupUrl,
      );
    } catch (e) {
      step('CDP Page.navigate popup.html', false, e.message);
      flowError = `Page.navigate failed: ${e.message}`;
    }

    // ── 轮询 Popup Ready 标记 ──────────────────────────────────
    // ESM module（type="module"）加载是异步的，需要更长等待
    const DEBUG_POPUP = process.env.DEBUG_POPUP === '1';
    const readyDeadline = Date.now() + 20000;
    while (Date.now() < readyDeadline && !isOverdue()) {
      await sleep(300);
      if (cdpSocketClosed) {
        flowError = 'CDP socket closed during popup ready poll';
        break;
      }
      try {
        const evalResult = await browserClient.send(
          'Runtime.evaluate',
          {
            expression: 'globalThis.__DESIGNWAN_POPUP_READY__ === true',
            returnByValue: true,
          },
          popupSessionId,
          5000,
        );
        if (DEBUG_POPUP) {
          console.log(`[debug-popup] ready=${evalResult.result?.value}`);
        }
        if (evalResult.result?.value === true) {
          popupReady = true;
          break;
        }
      } catch (e) {
        if (DEBUG_POPUP) console.log(`[debug-popup] error: ${e.message}`);
        // 如果 socket 关闭，停止轮询
        if (cdpSocketClosed) {
          flowError = `CDP socket closed during ready poll: ${e.message}`;
          break;
        }
      }
    }

    step('popup __DESIGNWAN_POPUP_READY__ === true', popupReady, popupReady ? '' : 'not set');

    // ── Ready 后额外等待，收集后续 console.error 等事件 ────────
    // 第五轮 §A.4 反例：Popup Ready 后 console.error 必须 exit 1。
    // Ready 标记设置后紧接着的 console.error 可能尚未通过 CDP 事件到达，
    // 需要 grace period 确保 Runtime.consoleAPICalled 被采集。
    if (popupReady) {
      await sleep(POST_READY_GRACE_MS);
    }

    // SW 附着后也等待一段时间，收集 SW 启动后的异常和 error log
    if (swAttached) {
      // SW 的事件可能在 attach 后陆续到达，等 2s 确保采集延迟 throw 等异步异常
      await sleep(2000);
    }
  } catch (e) {
    flowError = `CDP flow error: ${e.message}`;
  }

  // ── 阶段 3：汇总错误证据 ─────────────────────────────────────
  const popupSummary = browserClient
    ? browserClient.summarize(popupSessionId)
    : { exceptions: 0, consoleErrors: 0, logErrors: 0, details: [] };
  const swSummary = browserClient
    ? browserClient.summarize(swSessionId)
    : { exceptions: 0, consoleErrors: 0, logErrors: 0, details: [] };
  const browserSummary = browserClient
    ? browserClient.summarize(null)
    : { exceptions: 0, consoleErrors: 0, logErrors: 0, details: [] };

  // browser-level Log 中，只关注与 DesignWan 扩展相关的 error
  // （Chrome 内置扩展的 Log 不应算作 DesignWan 失败）
  const designwanBrowserErrors = browserSummary.details.filter(
    (d) =>
      /designwan|background\.js|chrome-extension/i.test(d) ||
      (designwanExtensionId && d.includes(designwanExtensionId)),
  );

  const popupErrorCount =
    popupSummary.exceptions + popupSummary.consoleErrors + popupSummary.logErrors;
  const swErrorCount = swSummary.exceptions + swSummary.consoleErrors + swSummary.logErrors;

  step(
    'popup: no Runtime.exceptionThrown',
    popupSummary.exceptions === 0,
    popupSummary.exceptions > 0 ? popupSummary.details.join('; ').slice(0, 300) : '',
  );
  step(
    'popup: no console.error',
    popupSummary.consoleErrors === 0,
    popupSummary.consoleErrors > 0
      ? popupSummary.details
          .filter((d) => d.includes('consoleAPICalled'))
          .join('; ')
          .slice(0, 300)
      : '',
  );
  step(
    'popup: no Log.entryAdded(error)',
    popupSummary.logErrors === 0,
    popupSummary.logErrors > 0
      ? popupSummary.details
          .filter((d) => d.includes('entryAdded'))
          .join('; ')
          .slice(0, 300)
      : '',
  );
  step(
    'SW: no Runtime.exceptionThrown',
    swSummary.exceptions === 0,
    swSummary.exceptions > 0 ? swSummary.details.join('; ').slice(0, 300) : '',
  );
  step(
    'SW: no console.error',
    swSummary.consoleErrors === 0,
    swSummary.consoleErrors > 0
      ? swSummary.details
          .filter((d) => d.includes('consoleAPICalled'))
          .join('; ')
          .slice(0, 300)
      : '',
  );
  step(
    'SW: no Log.entryAdded(error)',
    swSummary.logErrors === 0,
    swSummary.logErrors > 0
      ? swSummary.details
          .filter((d) => d.includes('entryAdded'))
          .join('; ')
          .slice(0, 300)
      : '',
  );
  step(
    'browser: no DesignWan-related Log.error',
    designwanBrowserErrors.length === 0,
    designwanBrowserErrors.length > 0 ? designwanBrowserErrors.join('; ').slice(0, 300) : '',
  );
  step('CDP socket not closed early', !cdpSocketClosed, cdpSocketClosed ? 'socket closed' : '');

  // 检查 stderr 致命错误
  const fatalErrors = [
    'Manifest is not valid',
    'Service worker registration failed',
    'Content Security Policy',
    'Could not load',
    'ERR_FILE_NOT_FOUND',
  ];
  const foundFatal = fatalErrors.filter((e) => stderr.includes(e));
  step('no fatal errors in stderr', foundFatal.length === 0, foundFatal.join(', ') || '');

  // 打印 error 详情，便于反例测试断言具体失败原因
  const allDetails = [
    ...popupSummary.details.map((d) => `[popup] ${d}`),
    ...swSummary.details.map((d) => `[sw] ${d}`),
    ...designwanBrowserErrors.map((d) => `[browser] ${d}`),
  ];
  if (allDetails.length > 0) {
    console.log('--- collected error evidence ---');
    for (const d of allDetails) {
      console.log(d);
    }
  }

  // 在 cleanupChrome 之前计算 ok，因为 Browser.close 会触发 onClose 设置 cdpSocketClosed=true
  const ok =
    version !== null &&
    !chromeReallyExited &&
    designwanExtensionId !== null &&
    ownTargets.length > 0 &&
    popupReady &&
    popupErrorCount === 0 &&
    swErrorCount === 0 &&
    designwanBrowserErrors.length === 0 &&
    !cdpSocketClosed &&
    foundFatal.length === 0 &&
    !flowError;

  // ── 阶段 4：清理 ─────────────────────────────────────────────
  await cleanupChrome(browserClient, child, DEBUG_PORT, userDataDir);

  if (stderr.trim()) {
    console.log('stderr (first 500 chars):');
    console.log(stderr.slice(0, 500));
  }

  console.log('==============================================================');

  if (ok) {
    console.log('extension-chrome-smoke: PASS');
    process.exit(0);
  } else {
    if (flowError) console.log(`[FAIL reason] ${flowError}`);
    console.log('extension-chrome-smoke: FAIL');
    process.exit(1);
  }
}

main().catch(async (e) => {
  console.error('[chrome-smoke] fatal:', e);
  process.exit(1);
});
