/**
 * Desktop 构建后处理：esbuild 打包 Preload(CJS) + Renderer(React bundle) + 复制 HTML。
 *
 * 为什么不用 tsc 直接输出：
 * - Preload 在 sandbox 模式下不支持 ESM import，必须编译为 CJS（.cjs）
 * - Renderer 使用 JSX + React，浏览器无法解析裸 import，必须 bundle 成单文件
 * - tsc 只做类型检查和 main 编译，esbuild 负责产物打包
 */
import { cp, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(here, '..');
const dist = join(desktopRoot, 'dist');

async function buildPreload() {
  await esbuild.build({
    entryPoints: [join(desktopRoot, 'src/preload/index.ts')],
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: ['chrome130'],
    external: ['electron'],
    outfile: join(dist, 'preload/index.cjs'),
    sourcemap: true,
    legalComments: 'none',
    logLevel: 'info',
  });
  console.log('[build] preload -> dist/preload/index.cjs');
}

async function buildRenderer() {
  await esbuild.build({
    entryPoints: [join(desktopRoot, 'src/renderer/renderer.tsx')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['chrome130'],
    outfile: join(dist, 'renderer/renderer.js'),
    sourcemap: true,
    legalComments: 'none',
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
    logLevel: 'info',
  });

  // 复制 index.html 到 dist/renderer/
  await mkdir(join(dist, 'renderer'), { recursive: true });
  await cp(join(desktopRoot, 'src/renderer/index.html'), join(dist, 'renderer/index.html'));
  console.log('[build] renderer -> dist/renderer/renderer.js + index.html');
}

try {
  await buildPreload();
  await buildRenderer();
  console.log('[build] desktop artifacts ready');
} catch (e) {
  console.error('[build] failed:', e);
  process.exit(1);
}
