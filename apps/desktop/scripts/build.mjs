/**
 * Desktop 构建后处理：esbuild 打包 Main(ESM) + Preload(CJS) + Renderer(React bundle) +
 * 复制 HTML + 复制 sqlite-vec 平台原生扩展到 dist/main/spike-vec/。
 *
 * 为什么不用 tsc 直接输出 Main：
 * - 02-E 让 better-sqlite3-multiple-ciphers 进 dependencies 触发 electron-builder
 *   对整个 node_modules 树的深度扫描（含 workspace 包 symlink 指向 packages/），
 *   导致 `packages/contracts/dist/ai/index.d.ts.map must be under apps/desktop/` 错误。
 * - 用 esbuild bundle Main 后，@designwan/contracts/modules/platform/ui 被 inline
 *   到 dist/main/index.js，可从 dependencies 移除 workspace 包，electron-builder
 *   不再 follow workspace symlink。
 * - better-sqlite3-multiple-ciphers 与 sqlite-vec 仍是 external（native 模块不能被 inline），
 *   spike-runner 用 createRequire + dynamic require 加载它们。
 *
 * 为什么不用 tsc 直接输出 Preload：
 * - Preload 在 sandbox 模式下不支持 ESM import，必须编译为 CJS（.cjs）
 *
 * 为什么不用 tsc 直接输出 Renderer：
 * - Renderer 使用 JSX + React，浏览器无法解析裸 import，必须 bundle 成单文件
 *
 * 为什么手动复制 vec0 扩展：
 * - pnpm 的 symlink 结构让 electron-builder asarUnpack glob 难以精确匹配平台子包
 * - sqlite-vec 平台子包（sqlite-vec-darwin-arm64 等）不在 apps/desktop/node_modules 下，
 *   electron-builder 不会自动打包到 asar
 * - 手动复制到 dist/main/spike-vec/ 后，asarUnpack 用精确路径 "dist/main/spike-vec/**"
 * - spike-runner.ts 用 import.meta.dirname/spike-vec/vec0.<ext> 解析，不依赖 asar 内 require
 */
import { cp, mkdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import esbuild from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(here, '..');
const dist = join(desktopRoot, 'dist');
const require = createRequire(import.meta.url);

/**
 * Bundle Main 进程为 ESM。
 *
 * - workspace 包（@designwan/*）被 inline 到 dist/main/index.js
 * - electron / better-sqlite3-multiple-ciphers / sqlite-vec 标记为 external
 *   - electron：runtime 提供
 *   - better-sqlite3-multiple-ciphers：native 模块，spike-runner 用 createRequire 加载
 *   - sqlite-vec：dev fallback 路径用，packaged 路径走 dist/main/spike-vec/
 */
async function buildMain() {
  await esbuild.build({
    entryPoints: [join(desktopRoot, 'src/main/index.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: ['node24'],
    external: ['electron', 'better-sqlite3-multiple-ciphers', 'sqlite-vec'],
    outfile: join(dist, 'main/index.js'),
    sourcemap: true,
    legalComments: 'none',
    logLevel: 'info',
    // 主进程是 ESM，banner 里不能注入 require（会冲突）
    // createRequire(import.meta.url) 由 spike-runner 自身处理
  });
  console.log('[build] main -> dist/main/index.js (esm, workspace inlined)');
}

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

/**
 * 复制当前平台的 sqlite-vec 原生扩展到 dist/main/spike-vec/。
 * 通过 sqlite-vec 包的 getLoadablePath() 解析平台子包路径，确保与运行时一致。
 */
async function copySpikeVecExtension() {
  const { getLoadablePath } = require('sqlite-vec');
  const srcPath = getLoadablePath();
  if (!existsSync(srcPath)) {
    throw new Error(`sqlite-vec loadable not found at: ${srcPath}`);
  }
  const destDir = join(dist, 'main', 'spike-vec');
  await mkdir(destDir, { recursive: true });
  // 统一命名为 vec0.<ext>，避免 spike-runner 里再做平台判断
  const ext = process.platform === 'win32' ? 'dll' : process.platform === 'darwin' ? 'dylib' : 'so';
  const destPath = join(destDir, `vec0.${ext}`);
  await copyFile(srcPath, destPath);
  console.log(`[build] spike-vec -> dist/main/spike-vec/vec0.${ext} (from ${srcPath})`);
}

try {
  await buildMain();
  await buildPreload();
  await buildRenderer();
  await copySpikeVecExtension();
  console.log('[build] desktop artifacts ready');
} catch (e) {
  console.error('[build] failed:', e);
  process.exit(1);
}
