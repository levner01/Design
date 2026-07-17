/**
 * Browser Extension 构建后处理：esbuild 打包 popup.js + background.js。
 *
 * 为什么不用 tsc 直接输出：
 * - popup.ts / background.ts 依赖 `@designwan/contracts`（bare import）
 * - Chrome 扩展运行时无法解析 node_modules 的 bare import
 * - esbuild bundle 会把 contracts 常量内联进单文件，Chrome 才能执行
 *
 * 依赖说明（第五次整改 §E）：
 * - esbuild 声明在本包（@designwan/browser-extension）的 devDependencies
 * - 不再通过 createRequire 从 apps/desktop 私有 node_modules 跨包加载
 * - 避免 App 之间的私有依赖穿透
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const extRoot = join(here, '..');
const dist = join(extRoot, 'dist');

// 从本包自身 node_modules 解析 esbuild（pnpm workspace 隔离模式下，
// esbuild 会安装到本包的 node_modules/.pnpm 调度路径下）
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

async function bundlePopup() {
  await esbuild.build({
    entryPoints: [join(extRoot, 'src/popup.ts')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['chrome130'],
    outfile: join(dist, 'popup.js'),
    sourcemap: true,
    legalComments: 'none',
    logLevel: 'info',
  });
  console.log('[build] popup -> dist/popup.js (bundled, no bare imports)');
}

async function bundleBackground() {
  await esbuild.build({
    entryPoints: [join(extRoot, 'src/background.ts')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['chrome130'],
    outfile: join(dist, 'background.js'),
    sourcemap: true,
    legalComments: 'none',
    logLevel: 'info',
  });
  console.log('[build] background -> dist/background.js (bundled, no bare imports)');
}

try {
  await bundlePopup();
  await bundleBackground();
  console.log('[build] extension artifacts ready');
} catch (e) {
  console.error('[build] failed:', e);
  process.exit(1);
}
