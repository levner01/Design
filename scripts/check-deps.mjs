#!/usr/bin/env node
/**
 * DesignWan 依赖方向检查器。
 *
 * 扫描所有 workspace 包 src 下的 .ts 文件，提取 `@designwan/*` import，
 * 对照 DEP_RULES 与 SUBPATH_RULES 验证是否符合 Local-first 依赖方向。
 *
 * 退出码：0 = 通过；1 = 发现违规或扫描失败。
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEP_RULES, SUBPATH_RULES, DESIGNWAN_PKG_PREFIX } from './deps-rules.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

const pkgNameByPath = new Map();
const pkgPathByName = new Map();

async function loadWorkspace() {
  const entries = await readdir(root, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'docs') continue;
    const pkgJsonPath = join(root, e.name, 'package.json');
    if (e.name === 'packages' || e.name === 'apps') {
      await scanSubdir(join(root, e.name));
      continue;
    }
    await tryRegister(pkgJsonPath);
  }
}

async function scanSubdir(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const pkgJsonPath = join(dir, e.name, 'package.json');
    await tryRegister(pkgJsonPath);
  }
}

async function tryRegister(pkgJsonPath) {
  let pkg;
  try {
    pkg = JSON.parse(await readFile(pkgJsonPath, 'utf8'));
  } catch {
    return;
  }
  if (!pkg.private || !pkg.name) return;
  const pkgDir = pkgJsonPath.replace(/package\.json$/, '');
  pkgNameByPath.set(pkgDir, pkg.name);
  pkgPathByName.set(pkg.name, pkgDir);
}

const TS_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);

async function walkTs(dir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name === 'build' || e.name === 'out')
      continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await walkTs(full)));
    } else if (e.isFile() && TS_EXTENSIONS.has(extname(e.name))) {
      out.push(full);
    }
  }
  return out;
}

const IMPORT_RE = /(?:^|[^.\w])import\s+(?:[\w*\s{},]+from\s+)?['"](@designwan\/[^'"]+)['"]/gm;

async function findOwningPackage(filePath) {
  let dir = filePath;
  while (dir.startsWith(root)) {
    dir = dir.slice(0, dir.lastIndexOf(sep));
    if (pkgNameByPath.has(dir + sep)) {
      return { pkgName: pkgNameByPath.get(dir + sep), pkgDir: dir };
    }
    if (pkgNameByPath.has(dir)) {
      return { pkgName: pkgNameByPath.get(dir), pkgDir: dir };
    }
    if (dir === root) break;
  }
  return null;
}

function findSubpathRule(filePath) {
  const rel = relative(root, filePath);
  for (const key of Object.keys(SUBPATH_RULES)) {
    if (rel.startsWith(key + sep) || rel === key) {
      return SUBPATH_RULES[key];
    }
  }
  return null;
}

function isTypeOnlyImport(line, matchIndex) {
  // 简化判定：检查 import 语句是否以 `import type` 开头
  const lineStart = line.lastIndexOf('\n', matchIndex) + 1;
  const stmt = line.slice(lineStart, matchIndex);
  return /^\s*import\s+type\b/.test(stmt) || /\btype\s+/.test(stmt.slice(0, 20));
}

async function main() {
  await loadWorkspace();

  const srcDirs = [join(root, 'packages'), join(root, 'apps')];

  const violations = [];
  const scannedFiles = [];

  for (const srcDir of srcDirs) {
    const files = await walkTs(srcDir);
    for (const f of files) {
      scannedFiles.push(f);
      const content = await readFile(f, 'utf8');
      const owner = await findOwningPackage(f);
      if (!owner) continue;
      const allowed = DEP_RULES[owner.pkgName];
      if (!allowed) continue;

      const subRule = findSubpathRule(f);
      const effective = subRule ?? allowed;

      let m;
      IMPORT_RE.lastIndex = 0;
      while ((m = IMPORT_RE.exec(content)) !== null) {
        const importedPkg = m[1].split('/')[0] + '/' + (m[1].split('/')[1] ?? '');
        const barePkg = m[1].split('/').slice(0, 2).join('/');
        const pkgRoot = barePkg;
        if (!effective.includes(pkgRoot)) {
          const isType = isTypeOnlyImport(content, m.index);
          // Type-only import 在 contracts 范围内允许（用于跨包共享类型）
          if (isType && effective.includes('@designwan/contracts')) {
            // 仍需校验：renderer/preload 不能 import modules/platform 的类型
            if (pkgRoot === '@designwan/contracts') continue;
          }
          violations.push({
            file: relative(root, f),
            owner: owner.pkgName,
            imported: m[1],
            allowed: effective,
            subpathRule: subRule ? 'yes' : 'no',
            isTypeOnly: isType,
          });
        }
      }
    }
  }

  if (violations.length === 0) {
    console.log(
      `[check-deps] OK. Scanned ${scannedFiles.length} TS files; 0 dependency-direction violations.`,
    );
    process.exit(0);
  }

  console.error(`[check-deps] FAIL. ${violations.length} violation(s):`);
  for (const v of violations) {
    console.error(
      `  - ${v.file}: owner=${v.owner} imports=${v.imported} allowed=[${v.allowed.join(', ')}] ` +
        `(subpathRule=${v.subpathRule}, typeOnly=${v.isTypeOnly})`,
    );
  }
  process.exit(1);
}

void main().catch((e) => {
  console.error('[check-deps] fatal:', e);
  process.exit(1);
});
