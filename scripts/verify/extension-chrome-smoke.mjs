#!/usr/bin/env node
/**
 * Chrome Extension 真实加载 Smoke（第四次复验 §5.4.2）。
 *
 * 修复：
 * - 动态分配调试端口，避免固定 19222 与已有 Chrome 冲突
 * - 从 DesignWan Service Worker URL 确定 Extension ID
 * - 只接受该 Extension ID 的 Target，不接受任意扩展
 * - 通过 CDP 打开 chrome-extension://<id>/popup.html
 * - 通过 Runtime.evaluate 验证 globalThis.__DESIGNWAN_POPUP_READY__ === true
 * - 监听 Runtime.exceptionThrown / Log.entryAdded
 * - Chrome 子进程提前退出、CDP 连接错误、Target 不匹配和 Timeout 都 exit 1
 * - 测试结束安全清理 Chrome 进程和临时 Profile
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, globSync } from 'node:fs';
import * as os from 'node:os';
import { join, dirname } from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { banner, step } from './lib/not-implemented.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
// DESIGNWAN_EXT_DIST 供反例测试注入损坏产物；默认指向真实 dist。
const extDist = process.env.DESIGNWAN_EXT_DIST
  ? join(process.env.DESIGNWAN_EXT_DIST)
  : join(root, 'apps/browser-extension/dist');

function findChrome() {
  const candidates = [];
  // Chrome for Testing 和 Chromium 支持 --load-extension；
  // Chrome stable 150+ 禁用了 --load-extension（extension_service.cc 报
  // "is not allowed in Google Chrome"），因此优先使用 Chrome for Testing。
  if (process.platform === 'darwin') {
    // 1. Chrome for Testing（Playwright cache，跨平台 CI 可复现）
    candidates.push(
      ...globSync(
        join(
          os.homedir(),
          'Library/Caches/ms-playwright/chromium-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
        ),
      ),
    );
    // 2. Chromium / Canary / Beta（开发机常见）
    candidates.push('/Applications/Chromium.app/Contents/MacOS/Chromium');
    candidates.push('/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary');
    candidates.push('/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta');
    // 3. Chrome stable（仅作最后兜底，若版本允许）
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
 * 简单的 CDP WebSocket 客户端。
 * 用 Node 22+ 内置 WebSocket（global.WebSocket）。
 */
class CdpClient {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.exceptions = [];
    this.logEntries = [];
    this._onMessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`CDP error: ${JSON.stringify(msg.error)}`));
        else resolve(msg.result);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        this.exceptions.push(msg.params);
      } else if (msg.method === 'Log.entryAdded') {
        this.logEntries.push(msg.params.entry);
      }
    };
    this.ws.addEventListener('message', this._onMessage);
  }

  static async connect(url) {
    const ws = new WebSocket(url);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('WebSocket connect timeout')), 5000);
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

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const msg = { id, method, params };
      if (sessionId) msg.sessionId = sessionId;
      this.ws.send(JSON.stringify(msg));
    });
  }

  close() {
    try {
      this.ws.close();
    } catch {
      // 已关闭
    }
  }
}

async function waitForExit(child, timeoutMs = 5000) {
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

async function main() {
  banner('extension-chrome-smoke (M0-01)');

  // DESIGNWAN_CHROME_BIN 供反例测试注入假 Chrome（立即退出的程序）。
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
  step(`dynamic debug port allocated`, true, String(DEBUG_PORT));

  const SMOKE_TIMEOUT_MS = 45000;
  const headless = process.env.HEADLESS === '1';
  const userDataDir = mkdtempSync(join(os.tmpdir(), 'designwan-chrome-'));
  const chromeArgs = [
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    // Chrome 150+ 对 unpacked 扩展强制 Content Verification，但 unpacked 扩展没有
    // Web Store 签名的 verified_contents.json，导致 reason:1 (NO_HASHES) 错误，
    // popup.html 被替换为 Chrome 错误页面（main-frame-error interstitial）。
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
  let timedOut = false;

  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    try {
      child.kill('SIGTERM');
    } catch {
      // 已退出
    }
  }, SMOKE_TIMEOUT_MS);

  // 轮询 CDP 直到拿到 service worker target
  // 注意：macOS 上 Chrome 主进程会 fork 子进程后退出，这是正常行为，
  // 不应判为失败。只有 CDP 不可达才是真正的 Chrome 退出。
  let designwanExtensionId = null;
  let lastTargetCount = -1;
  const DEBUG_SW = process.env.DEBUG_SW === '1';
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    if (timedOut) break;
    version = await fetchJson(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
    if (version) {
      targets = await fetchJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      if (targets) {
        if (DEBUG_SW && targets.length !== lastTargetCount) {
          lastTargetCount = targets.length;
          console.log(`[debug][${i * 0.5}s] targets=${targets.length}`);
          for (const t of targets) {
            console.log(`  - ${t.type} ${t.url}`);
          }
        }
        // 从 DesignWan service worker target URL 提取 Extension ID。
        // 关键：必须验证 SW URL 指向 manifest 声明的 background.js，
        // 否则会误匹配 Chrome 内置扩展（如 Google Hangouts 的 thunk.js）。
        // Chrome CDP /json/list 的 type 兼容 service-worker / service_worker 两种写法。
        const swTargets = targets.filter(
          (t) => t.type === 'service-worker' || t.type === 'service_worker',
        );
        for (const t of swTargets) {
          const url = t.url || '';
          // DesignWan manifest 声明 background.service_worker = "background.js"
          if (url.endsWith('/background.js')) {
            const match = url.match(/^chrome-extension:\/\/([a-z]+)\//);
            if (match) {
              designwanExtensionId = match[1];
              break;
            }
          }
        }
        if (designwanExtensionId) break;
      }
    }
  }

  clearTimeout(timeoutHandle);

  step('CDP version reachable', version !== null, version ? version.Browser || '' : 'no response');
  // macOS 上 Chrome 主进程退出是正常的 fork 行为，不算提前退出
  // 真正的退出是 CDP 不可达
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

  if (!designwanExtensionId) {
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
    try {
      child.kill('SIGTERM');
    } catch {
      // 已退出
    }
    await waitForExit(child);
    rmSync(userDataDir, { force: true, recursive: true });
    console.log('extension-chrome-smoke: FAIL');
    process.exit(1);
  }
  step('DesignWan extension ID extracted from SW', true, designwanExtensionId);

  // 只接受该 Extension ID 的 Target
  const ownTargets = (targets || []).filter((t) =>
    (t.url || '').startsWith(`chrome-extension://${designwanExtensionId}/`),
  );
  step('DesignWan extension targets found', ownTargets.length > 0, `${ownTargets.length} targets`);

  // 通过 CDP 打开 popup.html 并验证 ready 标记
  let popupReady = false;
  let popupError = null;
  let cdpExceptions = [];
  let browserClient = null;
  let popupClient = null;

  try {
    const browserWsUrl = version.webSocketDebuggerUrl;
    browserClient = await CdpClient.connect(browserWsUrl);

    // 创建 popup target
    const popupUrl = `chrome-extension://${designwanExtensionId}/popup.html`;
    const createResult = await browserClient.send('Target.createTarget', { url: popupUrl });
    const targetId = createResult.targetId;
    step('CDP Target.createTarget popup.html', true, targetId);

    // 附着到 popup target
    const attachResult = await browserClient.send('Target.attachToTarget', {
      targetId,
      flatten: true,
    });
    const sessionId = attachResult.sessionId;

    // 在 popup session 上启用 Runtime + Log
    await browserClient.send('Runtime.enable', {}, sessionId);
    await browserClient.send('Log.enable', {}, sessionId);

    // 等待 popup.js 执行，验证 ready 标记
    // ESM module（type="module"）加载是异步的，需要更长等待
    const DEBUG_POPUP = process.env.DEBUG_POPUP === '1';
    for (let i = 0; i < 30; i++) {
      await sleep(300);
      try {
        const evalResult = await browserClient.send(
          'Runtime.evaluate',
          {
            expression: 'globalThis.__DESIGNWAN_POPUP_READY__ === true',
            returnByValue: true,
          },
          sessionId,
        );
        if (DEBUG_POPUP) {
          console.log(`[debug-popup][${i}] ready=${evalResult.result?.value}`);
        }
        if (evalResult.result?.value === true) {
          popupReady = true;
          break;
        }
      } catch (e) {
        popupError = e.message;
        if (DEBUG_POPUP) console.log(`[debug-popup][${i}] error:`, e.message);
      }
    }

    // 收集异常
    cdpExceptions = browserClient.exceptions;
  } catch (e) {
    popupError = e.message;
  }

  step('popup __DESIGNWAN_POPUP_READY__ === true', popupReady, popupError || '');
  step(
    'no Runtime.exceptionThrown',
    cdpExceptions.length === 0,
    cdpExceptions.length > 0 ? `${cdpExceptions.length} exceptions` : '',
  );

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

  if (browserClient) browserClient.close();
  try {
    child.kill('SIGTERM');
  } catch {
    // 已退出
  }
  await waitForExit(child);

  // 安全清理临时 Profile
  rmSync(userDataDir, { force: true, recursive: true });

  if (stderr.trim()) {
    console.log('stderr (first 500 chars):');
    console.log(stderr.slice(0, 500));
  }

  console.log('==============================================================');
  // macOS 上 Chrome 主进程 fork 子进程后退出是正常行为（chromeExited=true），
  // 只要 CDP 可达（version !== null）就说明 Chrome 子进程在运行，不算真正退出。
  // 真正的提前退出是 chromeExited && version === null（CDP 不可达）。
  const ok =
    version !== null &&
    !chromeReallyExited &&
    designwanExtensionId !== null &&
    ownTargets.length > 0 &&
    popupReady &&
    cdpExceptions.length === 0 &&
    foundFatal.length === 0;

  if (ok) {
    console.log('extension-chrome-smoke: PASS');
    process.exit(0);
  } else {
    console.log('extension-chrome-smoke: FAIL');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('[chrome-smoke] fatal:', e);
  process.exit(1);
});
