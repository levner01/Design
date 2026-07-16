/**
 * 将 manifest.json 与 popup.html 等静态资源复制到 dist 目录。
 * MV3 要求 manifest.json 与 service worker 在同一加载根。
 */
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const dist = join(root, 'dist');

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

await cp(join(root, 'manifest.json'), join(dist, 'manifest.json'));
await cp(join(root, 'src', 'popup.html'), join(dist, 'popup.html'));

console.log('[copy-manifest] manifest.json + popup.html -> dist/');
