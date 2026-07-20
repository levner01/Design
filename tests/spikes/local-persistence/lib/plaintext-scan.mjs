/**
 * M0-02 02-B：明文扫描工具
 *
 * 扫描 DB/WAL/SHM/Temp/Log 文件中是否出现固定敏感 Canary。
 * 加密库的 DB body 应被加密，Canary 不应以明文出现。
 *
 * 扫描策略：
 *   1. 读取整个文件二进制
 *   2. 用 Buffer.indexOf 查找 Canary（utf8 字节序列）
 *   3. 找到即视为泄漏，返回泄漏文件与偏移
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

/**
 * 扫描单个文件中的 Canary。
 * @param {string} filePath
 * @param {string} canary
 * @returns {{ file: string, found: boolean, offset?: number }}
 */
export function scanFile(filePath, canary) {
  if (!existsSync(filePath)) {
    return { file: filePath, found: false };
  }
  const buf = readFileSync(filePath);
  const canaryBuf = Buffer.from(canary, 'utf8');
  const offset = buf.indexOf(canaryBuf);
  return {
    file: filePath,
    found: offset !== -1,
    offset: offset !== -1 ? offset : undefined,
    size: buf.length,
  };
}

/**
 * 扫描目录下所有文件中的 Canary。
 * @param {string} dir
 * @param {string} canary
 * @param {object} [options]
 * @param {string[]} [options.extensions] - 仅扫描指定扩展名（如 ['.db', '.db-wal', '.db-shm']）
 * @returns {Array<{ file: string, found: boolean, offset?: number, size: number }>}
 */
export function scanDirectory(dir, canary, options = {}) {
  const results = [];
  if (!existsSync(dir)) {
    return results;
  }
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...scanDirectory(fullPath, canary, options));
      continue;
    }
    if (options.extensions && !options.extensions.some((ext) => entry.endsWith(ext))) {
      continue;
    }
    results.push(scanFile(fullPath, canary));
  }
  return results;
}

/**
 * 扫描指定的 DB 文件及相关的 -wal/-shm/-journal/-tmp 文件。
 * @param {string} dbPath
 * @param {string} canary
 * @returns {Array<{ file: string, found: boolean, offset?: number, size: number }>}
 */
export function scanDbFiles(dbPath, canary) {
  const candidates = [
    dbPath,
    `${dbPath}-wal`,
    `${dbPath}-shm`,
    `${dbPath}-journal`,
    `${dbPath}.tmp`,
  ];
  const results = [];
  for (const p of candidates) {
    if (existsSync(p)) {
      results.push(scanFile(p, canary));
    }
  }
  return results;
}

/**
 * 输出明文扫描总结。
 * @param {Array<{ file: string, found: boolean, offset?: number, size: number }>} results
 * @returns {{ passed: boolean, leaks: string[], summary: string }}
 */
export function summarizeScan(results) {
  const leaks = results.filter((r) => r.found);
  const lines = [
    '',
    '--- Plaintext Scan ---',
    ...results.map((r) => `  ${r.found ? 'LEAK' : 'OK  '} ${basename(r.file)} (${r.size} bytes)`),
  ];
  if (leaks.length > 0) {
    lines.push(`  LEAKS: ${leaks.length} files contain Canary plaintext`);
  } else {
    lines.push('  No plaintext Canary detected.');
  }
  return {
    passed: leaks.length === 0,
    leaks: leaks.map((l) => l.file),
    summary: lines.join('\n'),
  };
}
