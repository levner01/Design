#!/usr/bin/env node
/**
 * Chrome Extension 真实加载 Smoke。
 *
 * 用 Chrome/Chromium --load-extension 启动扩展，通过 CDP 验证：
 *   - Manifest 可加载（Chrome 不报 Manifest 错误）
 *   - MV3 Service Worker 注册成功（CDP targets 中有 service-worker 类型）
 *   - 无 Service Worker / CSP / 脚本错误
 *
 * 找不到 Chrome/Chromium 时明确 exit 1，不静默跳过。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { banner, step } from './lib/not-implemented.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const extDist = join(root, 'apps/browser-extension/dist');

function findChrome() {
  const candidates = [];
  if (process.platform === 'darwin') {
    candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    candidates.push('/Applications/Chromium.app/Contents/MacOS/Chromium');
    candidates.push('/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary');
  } else if (process.platform === 'win32') {
    candidates.push('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
    candidates.push('C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe');
  } else {
    candidates.push('/usr/bin/google-chrome');
    candidates.push('/usr/bin/chromium');
    candidates.push('/usr/bin/chromium-browser');
  }
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
    // 可能已经退出了
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

  const chromePath = findChrome();
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

  const DEBUG_PORT = 19222;
  const SMOKE_TIMEOUT_MS = 15000;

  // macOS/Windows 本地有显示器，不用 headless（headless 模式下 MV3 SW 注册受限）
  // CI 环境设 HEADLESS=1 启用 headless
  const headless = process.env.HEADLESS === '1';
  const userDataDir = mkdtempSync(join(tmpdir(), 'designwan-chrome-'));
  const chromeArgs = [
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${userDataDir}`,
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--load-extension=${extDist}`,
    '--enable-features=ExtensionsInDnsOverHttps',
  ];
  if (headless) {
    chromeArgs.unshift('--headless=new', '--no-sandbox', '--disable-dev-shm-usage');
  }

  const child = spawn(chromePath, chromeArgs, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  let stderr = '';
  child.stderr.on('data', (d) => {
    stderr += d.toString();
  });

  let version = null;
  let targets = null;
  let timedOut = false;

  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
  }, SMOKE_TIMEOUT_MS);

  // 轮询 CDP 直到拿到 service worker 或 extension target
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    if (timedOut) break;
    version = await fetchJson(`http://localhost:${DEBUG_PORT}/json/version`);
    if (version) {
      targets = await fetchJson(`http://localhost:${DEBUG_PORT}/json/list`);
      if (targets) {
        const hasSW = targets.some((t) => t.type === 'service-worker');
        const hasExt = targets.some((t) => (t.url || '').startsWith('chrome-extension://'));
        if (hasSW || hasExt) break;
      }
    }
  }

  clearTimeout(timeoutHandle);
  child.kill('SIGTERM');
  await waitForExit(child);

  // 验证结果
  step('CDP version reachable', version !== null, version ? version.Browser || '' : 'no response');

  const swTargets = targets ? targets.filter((t) => t.type === 'service-worker') : [];
  const extTargets = targets
    ? targets.filter((t) => (t.url || '').startsWith('chrome-extension://'))
    : [];
  step(
    'service worker or extension target found',
    swTargets.length > 0 || extTargets.length > 0,
    `${swTargets.length} SW + ${extTargets.length} ext targets`,
  );

  const fatalErrors = [
    'Manifest is not valid',
    'Service worker registration failed',
    'Content Security Policy',
    'Uncaught Error',
    'ERR_FILE_NOT_FOUND',
    'Could not load',
  ];
  const foundFatal = fatalErrors.filter((e) => stderr.includes(e));
  step('no fatal errors in stderr', foundFatal.length === 0, foundFatal.join(', ') || '');

  if (stderr.trim()) {
    console.log('stderr (first 500 chars):');
    console.log(stderr.slice(0, 500));
  }

  console.log('==============================================================');
  const ok =
    version !== null && (swTargets.length > 0 || extTargets.length > 0) && foundFatal.length === 0;

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
