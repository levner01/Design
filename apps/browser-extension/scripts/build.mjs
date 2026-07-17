/**
 * Browser Extension 构建后处理：esbuild 打包 popup.js + background.js。
 *
 * 为什么不用 tsc 直接输出：
 * - popup.ts / background.ts 依赖 `@designwan/contracts`（bare import）
 * - Chrome 扩展运行时无法解析 node_modules 的 bare import
 * - esbuild bundle 会把 contracts 常量内联进单文件，Chrome 才能执行
 *
 * 依赖说明：
 * - esbuild 声明在 @designwan/desktop 的 devDependencies（Electron 构建已使用）
 * - browser-extension 不重复声明，通过 createRequire 跨 workspace 引用
 *   （pnpm 严格隔离模式下，monorepo 共享构建工具的常见做法）
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// apps/browser-extension/scripts -> root（3 级）
const root = join(here, '..', '..', '..');
const desktopNodeModules = join(root, 'apps', 'desktop', 'node_modules');

const require = createRequire(import.meta.url);

let esbuild;
try {
  // pnpm workspace: esbuild 在 desktop 的 devDependencies
  esbuild = require(join(desktopNodeModules, 'esbuild'));
} catch {
  // fallback: 尝试从当前包或 root 解析（如未来 hoist 策略变化）
  esbuild = require('esbuild');
}

const extRoot = join(here, '..');
const dist = join(extRoot, 'dist');

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
