/**
 * 将 manifest.json 与 popup.html 复制到 dist 目录（不删除已编译的 JS）。
 * MV3 要求 manifest.json 与 service worker 在同一加载根。
 *
 * 旧版本 rm -rf dist 会导致 tsc 编译的 background.js / popup.js 被删除，
 * Chrome 加载扩展时报 ERR_FILE_NOT_FOUND。
 */
import { cp, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const dist = join(root, 'dist');

// 只创建 dist 目录，不删除已有编译产物
await mkdir(dist, { recursive: true });

await cp(join(root, 'manifest.json'), join(dist, 'manifest.json'));
await cp(join(root, 'src', 'popup.html'), join(dist, 'popup.html'));

// 验证产物引用完整性：manifest 声明的文件必须存在
const manifest = JSON.parse(
  await import('node:fs').then((m) => m.readFileSync(join(dist, 'manifest.json'), 'utf8')),
);
const requiredFiles = [];
if (manifest.background?.service_worker) {
  requiredFiles.push(manifest.background.service_worker);
}
if (manifest.action?.default_popup) {
  requiredFiles.push(manifest.action.default_popup);
  // popup.html 中引用的脚本也必须存在
  const popupHtml = await import('node:fs').then((m) =>
    m.readFileSync(join(dist, manifest.action.default_popup), 'utf8'),
  );
  const scriptMatch = popupHtml.match(/<script[^>]+src=["']\.\/([^"']+)["']/);
  if (scriptMatch) {
    requiredFiles.push(scriptMatch[1]);
  }
}

const missing = requiredFiles.filter((f) => !existsSync(join(dist, f)));
if (missing.length > 0) {
  console.error('[copy-manifest] MISSING artifacts:', missing);
  process.exit(1);
}

console.log('[copy-manifest] manifest.json + popup.html -> dist/ (artifacts verified)');
