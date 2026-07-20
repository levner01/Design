#!/usr/bin/env node
/**
 * M0-02 02-B：并发读写 worker
 *
 * 通过 worker_threads 启动，每个 worker 持有独立的 Database 连接。
 * 模式：
 *   - writer: 连续 INSERT N 条数据
 *   - reader: 连续 SELECT COUNT(*) 或 SELECT *，记录成功/失败/快照
 *
 * 主线程聚合所有 worker 结果，验证：
 *   - writer 完成所有 INSERT
 *   - reader 不报 SQLITE_BUSY
 *   - 最终 COUNT 一致
 */

import { parentPort, workerData } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// concurrent-worker.mjs 位于 tests/spikes/local-persistence/lib/，需要 4 个 .. 回到 REPO_ROOT
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const DESKTOP_PKG = join(REPO_ROOT, 'apps', 'desktop', 'package.json');
const require = createRequire(DESKTOP_PKG);
const Database = require('better-sqlite3-multiple-ciphers');

const { mode, dbPath, key, iterations, workerId } = workerData;

const result = {
  workerId,
  mode,
  iterations,
  success: 0,
  errors: [],
  snapshots: [],
  durationMs: 0,
};

const start = Date.now();

try {
  const db = new Database(dbPath);
  db.pragma(`key = '${key.replace(/'/g, "''")}'`);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 10000');
  db.pragma('foreign_keys = ON');

  if (mode === 'writer') {
    const ins = db.prepare(
      "INSERT INTO spike_documents (title, content, created_at) VALUES (?, ?, ?)",
    );
    for (let i = 0; i < iterations; i++) {
      try {
        ins.run(`writer-title-${i}`, `writer-content-${i}`, new Date().toISOString());
        result.success++;
      } catch (e) {
        result.errors.push({ iter: i, message: e.message, code: e.code });
      }
    }
  } else if (mode === 'reader') {
    const sel = db.prepare('SELECT COUNT(*) AS c FROM spike_documents');
    for (let i = 0; i < iterations; i++) {
      try {
        const r = sel.get();
        result.snapshots.push(r.c);
        result.success++;
      } catch (e) {
        result.errors.push({ iter: i, message: e.message, code: e.code });
      }
    }
  }

  db.close();
} catch (e) {
  result.fatalError = e.message;
}

result.durationMs = Date.now() - start;
parentPort.postMessage(result);
