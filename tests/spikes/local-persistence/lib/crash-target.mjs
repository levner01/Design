#!/usr/bin/env node
/**
 * M0-02 02-B：Crash 模拟子进程
 *
 * 接收 parent 通过 argv 传来的指令：
 *   --db=<path>          DB 文件路径
 *   --key=<passphrase>   加密 Key
 *   --op=<operation>     要执行的操作：
 *                           migration-v1   执行 Migration v1（在 COMMIT 前 sleep）
 *                           migration-v2   执行 Migration v2（在 COMMIT 前 sleep）
 *                           txn-uncommitted  开启事务写入数据但不 commit（验证未提交不可见）
 *                           txn-committed    开启事务写入数据并 commit（验证已提交保留）
 *   --sentinel=<path>    准备就绪后写入此文件
 *   --hold-sec=<n>       在 COMMIT 之前 sleep 的秒数（默认 30）
 *
 * 子进程会：
 *   1. 打开 DB（带 Key）
 *   2. 执行 BEGIN 与部分操作
 *   3. 写 sentinel
 *   4. 进入 hold（不响应 SIGTERM，等待 SIGKILL）
 *
 * SIGKILL 会立即终止进程，未提交事务不会 commit，WAL 会被遗留。
 * 重启后 SQLite 自动 rollback 未提交事务。
 */

import { writeFileSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// crash-target.mjs 位于 tests/spikes/local-persistence/lib/，需要 4 个 .. 回到 REPO_ROOT
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const DESKTOP_PKG = join(REPO_ROOT, 'apps', 'desktop', 'package.json');
const require = createRequire(DESKTOP_PKG);
const Database = require('better-sqlite3-multiple-ciphers');

function parseArgs(argv) {
  const out = {};
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function sleepSync(seconds) {
  // 同步 sleep：阻塞事件循环，让 SIGKILL 强杀生效
  const start = Date.now();
  while (Date.now() - start < seconds * 1000) {
    // busy wait
  }
}

const args = parseArgs(process.argv);
const dbPath = args.db;
const key = args.key;
const op = args.op;
const sentinelPath = args.sentinel;
const holdSec = Number(args['hold-sec'] ?? 30);

if (!dbPath || !key || !op || !sentinelPath) {
  console.error('Usage: crash-target.mjs --db=<path> --key=<pass> --op=<op> --sentinel=<path> [--hold-sec=30]');
  process.exit(2);
}

try {
  // 清理旧 sentinel
  try {
    unlinkSync(sentinelPath);
  } catch {
    // ignore
  }

  const db = new Database(dbPath);
  db.pragma(`key = '${key.replace(/'/g, "''")}'`);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');

  if (op === 'migration-v1') {
    // 执行 Migration v1 的 DDL，但不 commit
    db.exec('BEGIN IMMEDIATE');
    db.exec(`
      CREATE TABLE spike_documents (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    // 写 sentinel 表示已进入事务但未 commit
    writeFileSync(sentinelPath, JSON.stringify({ op, stage: 'in-txn', ts: Date.now() }));
    // 在 commit 之前 hold，等待 SIGKILL
    sleepSync(holdSec);
    db.exec('COMMIT'); // 永远不会执行到这里
  } else if (op === 'migration-v2') {
    // 假设 v1 已应用，执行 v2 但不 commit
    db.exec('BEGIN IMMEDIATE');
    db.exec(`
      CREATE INDEX idx_spike_documents_created ON spike_documents(created_at);
      CREATE TABLE spike_canary (
        id INTEGER PRIMARY KEY,
        secret TEXT NOT NULL
      );
    `);
    writeFileSync(sentinelPath, JSON.stringify({ op, stage: 'in-txn', ts: Date.now() }));
    sleepSync(holdSec);
    db.exec('COMMIT');
  } else if (op === 'txn-uncommitted') {
    // 开启事务写入数据但不 commit
    db.exec('BEGIN IMMEDIATE');
    db.prepare("INSERT INTO spike_documents (title, content, created_at) VALUES (?, ?, ?)")
      .run('uncommitted-title', 'uncommitted-content', new Date().toISOString());
    writeFileSync(sentinelPath, JSON.stringify({ op, stage: 'in-txn', ts: Date.now() }));
    sleepSync(holdSec);
    db.exec('COMMIT');
  } else if (op === 'txn-committed') {
    // 立即提交（用于对照测试）
    db.exec('BEGIN IMMEDIATE');
    db.prepare("INSERT INTO spike_documents (title, content, created_at) VALUES (?, ?, ?)")
      .run('committed-title', 'committed-content', new Date().toISOString());
    db.exec('COMMIT');
    writeFileSync(sentinelPath, JSON.stringify({ op, stage: 'committed', ts: Date.now() }));
    // committed 后立即退出
    db.close();
    process.exit(0);
  } else {
    console.error(`Unknown op: ${op}`);
    process.exit(2);
  }

  db.close();
} catch (e) {
  // 即使出错也写 sentinel，让 parent 知道 child 已就绪
  try {
    writeFileSync(sentinelPath, JSON.stringify({ op, stage: 'error', error: e.message, ts: Date.now() }));
  } catch {
    // ignore
  }
  console.error('crash-target error:', e.message);
  process.exit(3);
}
