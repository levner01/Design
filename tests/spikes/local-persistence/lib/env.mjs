/**
 * M0-02 本地持久化 Spike — 环境探测工具
 *
 * 探测 SQLite/sqlite-vec/Node/Electron 的精确版本与编译选项，
 * 生成结构化环境信息用于候选矩阵与 02-A 测试断言。
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { arch, platform, versions } from 'node:process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

// Spike 依赖声明在 apps/desktop/package.json，必须从那里解析。
// env.mjs 位于 tests/spikes/local-persistence/lib/，需要 4 个 .. 回到 REPO_ROOT。
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const DESKTOP_PKG = join(REPO_ROOT, 'apps', 'desktop', 'package.json');
const require = createRequire(DESKTOP_PKG);

/**
 * 读取包的 package.json，返回关键字段。
 * 兼容包未在 exports 中暴露 ./package.json 的情况（如 sqlite-vec）。
 * @param {string} pkgName
 * @returns {{name: string, version: string, license?: string, author?: string, homepage?: string}}
 */
export function getPackageInfo(pkgName) {
  let pkgPath;
  try {
    pkgPath = require.resolve(`${pkgName}/package.json`);
  } catch {
    // fallback：解析包主入口，再向上逐级查找 package.json
    const entry = require.resolve(pkgName);
    let dir = dirname(entry);
    while (dir && dir !== '/' && dir !== dirname(dir)) {
      const candidate = join(dir, 'package.json');
      if (existsSync(candidate)) {
        const candidatePkg = JSON.parse(readFileSync(candidate, 'utf8'));
        if (candidatePkg.name === pkgName) {
          pkgPath = candidate;
          break;
        }
      }
      dir = dirname(dir);
    }
    if (!pkgPath) {
      throw new Error(`Cannot locate package.json for ${pkgName}`);
    }
  }
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  return {
    name: pkg.name,
    version: pkg.version,
    license: pkg.license,
    author: typeof pkg.author === 'string' ? pkg.author : pkg.author?.name,
    homepage: pkg.homepage,
  };
}

/**
 * 获取 better-sqlite3-multiple-ciphers 的版本与许可证信息。
 */
export function getDriverInfo() {
  return getPackageInfo('better-sqlite3-multiple-ciphers');
}

/**
 * 获取 sqlite-vec 的版本与许可证信息。
 */
export function getVecInfo() {
  return getPackageInfo('sqlite-vec');
}

/**
 * 查询 SQLite 内嵌版本。
 * @param {import('better-sqlite3-multiple-ciphers').Database} db
 * @returns {string}
 */
export function getSqliteVersion(db) {
  return db.prepare('SELECT sqlite_version() AS v').get().v;
}

/**
 * 查询 SQLite compile_options。
 * @param {import('better-sqlite3-multiple-ciphers').Database} db
 * @returns {string[]}
 */
export function getCompileOptions(db) {
  return db.prepare('PRAGMA compile_options').all().map((r) => r.compile_options);
}

/**
 * 检查是否启用了 FTS5。
 * @param {import('better-sqlite3-multiple-ciphers').Database} db
 * @returns {boolean}
 */
export function hasFts5(db) {
  const options = getCompileOptions(db);
  return options.some((o) => o === 'ENABLE_FTS5');
}

/**
 * 检查是否启用了 Foreign Keys 默认。
 * @param {import('better-sqlite3-multiple-ciphers').Database} db
 * @returns {boolean}
 */
export function hasDefaultForeignKeys(db) {
  const options = getCompileOptions(db);
  return options.some((o) => o === 'DEFAULT_FOREIGN_KEYS');
}

/**
 * 检查 THREADSAFE 模式。
 * @param {import('better-sqlite3-multiple-ciphers').Database} db
 * @returns {string} 例如 "THREADSAFE=2"
 */
export function getThreadsafeMode(db) {
  const options = getCompileOptions(db);
  return options.find((o) => o.startsWith('THREADSAFE=')) || 'THREADSAFE=?';
}

/**
 * 加载 sqlite-vec 扩展并返回版本。
 * @param {import('better-sqlite3-multiple-ciphers').Database} db
 * @returns {string}
 */
export function loadVecAndGetVersion(db) {
  const { getLoadablePath } = require('sqlite-vec');
  const vecPath = getLoadablePath();
  db.loadExtension(vecPath);
  return db.prepare('SELECT vec_version() AS v').get().v;
}

/**
 * 返回 sqlite-vec 平台子包路径（用于 asarUnpack 配置）。
 * @returns {string}
 */
export function resolveVecLoadablePath() {
  const { getLoadablePath } = require('sqlite-vec');
  return getLoadablePath();
}

/**
 * 返回 better-sqlite3-multiple-ciphers 的原生 .node 路径（用于 asarUnpack 配置）。
 * @returns {string}
 */
export function resolveDriverNativePath() {
  return require.resolve('better-sqlite3-multiple-ciphers/build/Release/better_sqlite3.node');
}

/**
 * 返回当前运行环境信息（Node 或 Electron）。
 * @returns {{runtime: 'node'|'electron', nodeVersion: string, electronVersion?: string, platform: string, arch: string, abi: number}}
 */
export function getEnvironmentInfo() {
  const isElectron = typeof versions.electron === 'string';
  return {
    runtime: isElectron ? 'electron' : 'node',
    nodeVersion: versions.node,
    electronVersion: versions.electron,
    platform,
    arch,
    abi: Number(versions.modules),
  };
}

/**
 * 完整探测结果（02-A 测试用）。
 * @param {import('better-sqlite3-multiple-ciphers').Database} db
 */
export function probeAll(db) {
  return {
    environment: getEnvironmentInfo(),
    driver: getDriverInfo(),
    sqlite: {
      version: getSqliteVersion(db),
      compileOptions: getCompileOptions(db),
      fts5: hasFts5(db),
      defaultForeignKeys: hasDefaultForeignKeys(db),
      threadsafe: getThreadsafeMode(db),
    },
    vec: {
      ...getVecInfo(),
      version: loadVecAndGetVersion(db),
      loadablePath: resolveVecLoadablePath(),
    },
  };
}
