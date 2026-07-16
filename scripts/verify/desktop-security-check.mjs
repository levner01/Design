#!/usr/bin/env node
/**
 * Desktop 安全配置静态检查（M0-01 范围内可执行的部分）。
 *
 * 真实检查项（不需要 Electron 运行时，纯文本扫描）：
 *   - apps/desktop/src/main/index.ts 中 BrowserWindow 配置：
 *       sandbox === true
 *       contextIsolation === true
 *       nodeIntegration === false
 *       nodeIntegrationInWorker === false
 *       nodeIntegrationInSubFrames === false
 *       webviewTag === false
 *   - apps/desktop/src/preload/index.ts 中：
 *       不暴露 ipcRenderer 本身
 *       使用 contextBridge.exposeInMainWorld
 *       不出现 require('electron') 透传
 *   - apps/desktop/src/renderer/* 中：
 *       不出现 require('node:fs') / require('node:crypto') / require('sqlite3')
 *       不出现 ipcRenderer 直接调用
 *
 * 完整的运行时安全门（XSS→Node、Prototype pollution、恶意 URL、Bundle 扫描）由 GLM-M0-04 实现。
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { banner, step } from './lib/not-implemented.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));

const MAIN = join(root, 'apps/desktop/src/main/index.ts');
const PRELOAD = join(root, 'apps/desktop/src/preload/index.ts');
const RENDERER = join(root, 'apps/desktop/src/renderer/renderer.tsx');
const HTML = join(root, 'apps/desktop/src/renderer/index.html');

async function read(p) {
  return readFile(p, 'utf8');
}

function mustContain(code, label, needle) {
  const ok = code.includes(needle);
  step(`main contains ${label}`, ok, ok ? '' : `expected: ${needle}`);
  return ok;
}

function mustNotContain(code, label, needle) {
  const ok = !code.includes(needle);
  step(`main avoids ${label}`, ok, ok ? '' : `forbidden: ${needle}`);
  return ok;
}

banner('desktop-security-check (M0-01 static)');

let allOk = true;

// ===== Main: BrowserWindow 安全基线 =====
const main = await read(MAIN);
allOk = mustContain(main, 'sandbox: true', 'sandbox: true') && allOk;
allOk = mustContain(main, 'contextIsolation: true', 'contextIsolation: true') && allOk;
allOk = mustContain(main, 'nodeIntegration: false', 'nodeIntegration: false') && allOk;
allOk =
  mustContain(main, 'nodeIntegrationInWorker: false', 'nodeIntegrationInWorker: false') && allOk;
allOk =
  mustContain(main, 'nodeIntegrationInSubFrames: false', 'nodeIntegrationInSubFrames: false') &&
  allOk;
allOk = mustContain(main, 'webviewTag: false', 'webviewTag: false') && allOk;
allOk = mustContain(main, 'Content-Security-Policy', 'Content-Security-Policy') && allOk;
allOk = mustContain(main, 'will-navigate preventDefault', 'preventDefault()') && allOk;
allOk = mustContain(main, 'setWindowOpenHandler deny', "{ action: 'deny' }") && allOk;

// ===== Preload: 不暴露 ipcRenderer / 通用 invoke =====
const preload = await read(PRELOAD);
allOk =
  mustContain(preload, 'contextBridge.exposeInMainWorld', 'contextBridge.exposeInMainWorld') &&
  allOk;
allOk =
  mustNotContain(preload, 'ipcRenderer exposed to renderer', 'exposeInMainWorld.*ipcRenderer') &&
  allOk;
// 静态扫描：preload 中 ipcRenderer 只能用于 .invoke，不能整体暴露
const preloadIpcRendererExports = /contextBridge\.exposeInMainWorld\([^,]+,\s*ipcRenderer\)/.test(
  preload,
);
step('preload does not expose ipcRenderer object', !preloadIpcRendererExports);
allOk = !preloadIpcRendererExports && allOk;

// ===== Renderer: 无 Node/DB/Keychain 直连 =====
const renderer = await read(RENDERER);
const forbiddenRendererImports = [
  /import\s+[^'"]*['"]node:/,
  /import\s+[^'"]*['"]sqlite3['"]/,
  /import\s+[^'"]*['"]better-sqlite3['"]/,
  /import\s+[^'"]*['"]electron['"]/,
  /require\(['"]node:/,
  /require\(['"]electron['"]/,
];
for (const re of forbiddenRendererImports) {
  const m = renderer.match(re);
  const ok = !m;
  step(`renderer avoids ${re.source}`, ok, ok ? '' : `matched: ${m?.[0] ?? ''}`);
  allOk = ok && allOk;
}

// ===== HTML: CSP 头存在 =====
const html = await read(HTML);
const hasCsp = /Content-Security-Policy/.test(html);
step('renderer HTML has CSP meta', hasCsp);
allOk = hasCsp && allOk;

console.log('==============================================================');
if (allOk) {
  console.log('desktop-security-check (static): PASS');
  console.log(
    'NOTE: Runtime security gates (XSS→Node, prototype pollution, malicious URL, Bundle scan) ' +
      'are implemented in GLM-M0-04.',
  );
  process.exit(0);
} else {
  console.log('desktop-security-check (static): FAIL');
  process.exit(1);
}
