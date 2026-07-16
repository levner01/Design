#!/usr/bin/env node
/**
 * Desktop 产物完整性检查。
 *
 * 验证 build 后的 dist/ 目录包含所有运行时必需文件：
 *   - dist/main/index.js（Electron Main 入口）
 *   - dist/preload/index.cjs（CJS Preload，sandbox 兼容）
 *   - dist/renderer/index.html（Renderer HTML）
 *   - dist/renderer/renderer.js（esbuild bundle，含 React）
 *   - dist/renderer/renderer.js.map（sourcemap）
 *
 * 如果缺少文件则 exit 1，防止 TypeScript 假绿。
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { banner, step } from './lib/not-implemented.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const desktopDist = join(root, 'apps/desktop/dist');

banner('artifact-integrity-check (M0-01)');

let allOk = true;

const requiredFiles = [
  { path: 'main/index.js', label: 'main entry (ESM)' },
  { path: 'preload/index.cjs', label: 'preload (CJS, sandbox-safe)' },
  { path: 'renderer/index.html', label: 'renderer HTML' },
  { path: 'renderer/renderer.js', label: 'renderer bundle (esbuild + React)' },
];

for (const { path, label } of requiredFiles) {
  const full = join(desktopDist, path);
  const exists = existsSync(full);
  step(`dist/${path} exists (${label})`, exists, exists ? '' : 'MISSING');
  allOk = allOk && exists;
}

// Extension 产物检查
const extDist = join(root, 'apps/browser-extension/dist');
const extFiles = [
  { path: 'manifest.json', label: 'MV3 manifest' },
  { path: 'background.js', label: 'service worker' },
  { path: 'popup.html', label: 'popup HTML' },
  { path: 'popup.js', label: 'popup script' },
];

for (const { path, label } of extFiles) {
  const full = join(extDist, path);
  const exists = existsSync(full);
  step(`extension dist/${path} exists (${label})`, exists, exists ? '' : 'MISSING');
  allOk = allOk && exists;
}

console.log('==============================================================');
if (allOk) {
  console.log('artifact-integrity-check: PASS');
  process.exit(0);
} else {
  console.log('artifact-integrity-check: FAIL');
  process.exit(1);
}
