#!/usr/bin/env node
/**
 * M0-02 02-B：加密 SQLite、Migration 与 Crash
 *
 * 覆盖 m2-02.md §四 02-B 全部 12 项验收点：
 *   1. 正确 Key 创建和重开
 *   2. 错误 Key 稳定失败
 *   3. 错误 Key 不得新建、截断或覆盖原库
 *   4. 原始 DB Header 不得出现 SQLite format 3
 *   5. DB/WAL/SHM/Temp/Log 不得出现固定敏感 Canary
 *   6. Foreign Keys、WAL、Busy Timeout
 *   7. v0→v1→v2 最小 Migration
 *   8. Migration 中途强杀，重启后只能是旧版本或完整新版本
 *   9. 事务中途 Kill，已提交数据保留，未提交数据不可见
 *   10. 1 个写入口 + 8 个并发读者压力
 *   11. quick_check/integrity_check 通过
 *   12. Crash Recovery 时间和 WAL 大小写入结果报告
 *
 * 退出码：0=全部 PASS，1=任一 FAIL
 * 报告：tests/spikes/local-persistence/run/02-b-encrypted-sqlite-recovery.json
 */

import { readFileSync, existsSync, statSync, writeSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

import { Harness } from './lib/harness.mjs';
import { ReasonCode } from './lib/reason-codes.mjs';
import {
  getDriverInfo,
  getSqliteVersion,
  getCompileOptions,
} from './lib/env.mjs';
import {
  createFixtureDir,
  cleanupFixtureDir,
  CANARY_TOKEN,
} from './lib/fixture.mjs';
import {
  initSchema,
  migrate,
  getSchemaVersion,
  assertMigrationsApplied,
} from './lib/schema.mjs';
import { scanDbFiles, summarizeScan } from './lib/plaintext-scan.mjs';
import { spawnAndKill } from './lib/crash.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const DESKTOP_PKG = join(REPO_ROOT, 'apps', 'desktop', 'package.json');
const require = createRequire(DESKTOP_PKG);
const Database = require('better-sqlite3-multiple-ciphers');

// pipe 输出时 console 会被块缓冲，诊断用 writeSync(2, ...) 强制无缓冲。
// 默认 off，提交时保留 trace 调用不影响生产。
const DIAG = process.env.SPIKE_DIAG === '1';
function trace(msg) {
  if (DIAG) writeSync(2, `[02-b] ${msg}\n`);
}

const harness = new Harness('02-b-encrypted-sqlite-recovery', {
  reportName: '02-b-encrypted-sqlite-recovery',
});

let fixtureDir;

// 包装 harness.run，在每个测试前后输出无缓冲 trace，定位卡点
async function runTraced(name, fn, ctx) {
  trace(`--> ${name}`);
  const r = await harness.run(name, fn, ctx);
  trace(`<-- ${name} ok=${r.ok} dur=${r.durationMs}ms reason=${r.reasonCode ?? '-'}`);
  if (!r.ok) trace(`    msg=${r.message}`);
  return r;
}

async function main() {
  trace('main entered');

  try {
    // 环境快照
    const probeDb = new Database(':memory:');
    harness.environment = {
      driver: getDriverInfo(),
      sqlite: {
        version: getSqliteVersion(probeDb),
        compileOptions: getCompileOptions(probeDb),
      },
    };
    probeDb.close();

    fixtureDir = createFixtureDir('02b');

    // ===== Test 1: 正确 Key 创建和重开 =====
    await runTraced('correct-key-create-reopen', () => {
      const dbPath = join(fixtureDir, 'correct-key.db');
      const db = new Database(dbPath);
      db.pragma("key = 'spike-test-key-1'");
      initSchema(db);
      db.prepare("INSERT INTO spike_meta (key, value) VALUES ('test', 'hello')").run();
      db.close();

      const db2 = new Database(dbPath);
      db2.pragma("key = 'spike-test-key-1'");
      const row = db2.prepare("SELECT value FROM spike_meta WHERE key = 'test'").get();
      harness.equal(row.value, 'hello', 'correct key should read back meta', ReasonCode.ENCRYPTION_DISABLED);
      harness.equal(getSchemaVersion(db2), 0, 'initial schema_version should be 0');
      db2.close();
    });

    // ===== Test 2: 错误 Key 稳定失败 =====
    await runTraced('wrong-key-stable-fail', () => {
      const dbPath = join(fixtureDir, 'wrong-key-stable.db');
      const db = new Database(dbPath);
      db.pragma("key = 'correct-key-2'");
      initSchema(db);
      db.close();

      let wrongKeyAccepted = false;
      try {
        const db2 = new Database(dbPath);
        db2.pragma("key = 'wrong-key-xxx'");
        db2.prepare("SELECT * FROM spike_meta").all();
        wrongKeyAccepted = true;
        db2.close();
      } catch (e) {
        harness.assert(
          /not a database|file is not/i.test(e.message),
          `wrong key should reject with 'not a database', got: ${e.message}`,
          ReasonCode.WRONG_KEY_ACCEPTED,
        );
      }
      harness.assert(!wrongKeyAccepted, 'wrong key MUST NOT be accepted', ReasonCode.WRONG_KEY_ACCEPTED);
    });

    // ===== Test 3: 错误 Key 不得新建、截断或覆盖原库 =====
    await runTraced('wrong-key-no-corruption', () => {
      const dbPath = join(fixtureDir, 'wrong-key-no-corrupt.db');
      const db = new Database(dbPath);
      db.pragma("key = 'correct-key-3'");
      initSchema(db);
      db.prepare("INSERT INTO spike_meta (key, value) VALUES ('preserved', 'data-3')").run();
      db.close();

      const originalSize = statSync(dbPath).size;
      harness.assert(originalSize > 0, 'DB should have non-zero size before wrong key');

      for (let i = 0; i < 3; i++) {
        try {
          const db2 = new Database(dbPath);
          db2.pragma(`key = 'wrong-key-${i}'`);
          db2.prepare('SELECT * FROM spike_meta').all();
          db2.close();
        } catch {
          // 预期错误 Key 失败，忽略具体 message
        }
      }

      const afterSize = statSync(dbPath).size;
      harness.equal(
        afterSize,
        originalSize,
        'wrong key must NOT change DB file size',
        ReasonCode.WRONG_KEY_ACCEPTED,
      );

      const db3 = new Database(dbPath);
      db3.pragma("key = 'correct-key-3'");
      const row = db3.prepare("SELECT value FROM spike_meta WHERE key = 'preserved'").get();
      harness.equal(row.value, 'data-3', 'data preserved after wrong key attempts');
      db3.close();
    });

    // ===== Test 4: DB Header 不得出现 SQLite format 3 =====
    await runTraced('db-header-no-plaintext', () => {
      const dbPath = join(fixtureDir, 'header-check.db');
      const db = new Database(dbPath);
      db.pragma("key = 'header-key-4'");
      initSchema(db);
      db.close();

      const buf = readFileSync(dbPath);
      const header = buf.subarray(0, 16).toString('utf8');
      harness.assert(
        !header.includes('SQLite format 3'),
        `DB header must NOT contain 'SQLite format 3' (got: ${JSON.stringify(header)})`,
        ReasonCode.PLAINTEXT_LEAK,
      );
    });

    // ===== Test 5: Canary 不出现在 DB/WAL/SHM/Temp/Log =====
    await runTraced('canary-no-plaintext-leak', () => {
      const dbPath = join(fixtureDir, 'canary-check.db');
      const db = new Database(dbPath);
      db.pragma("key = 'canary-key-5'");
      db.pragma('journal_mode = WAL');
      initSchema(db);
      db.exec('CREATE TABLE canary_test (id INTEGER PRIMARY KEY, secret TEXT NOT NULL)');
      db.prepare('INSERT INTO canary_test (secret) VALUES (?)').run(CANARY_TOKEN);
      db.prepare('INSERT INTO canary_test (secret) VALUES (?)').run(CANARY_TOKEN + '-2');
      db.pragma('wal_checkpoint(TRUNCATE)');
      db.close();

      const results = scanDbFiles(dbPath, CANARY_TOKEN);
      const summary = summarizeScan(results);
      harness.assert(
        summary.passed,
        `Canary plaintext leak detected in: ${summary.leaks.join(', ')}`,
        ReasonCode.PLAINTEXT_LEAK,
      );
    });

    // ===== Test 6: Foreign Keys / WAL / Busy Timeout =====
    await runTraced('pragma-config', () => {
      const dbPath = join(fixtureDir, 'pragma-config.db');
      const db = new Database(dbPath);
      db.pragma("key = 'pragma-key-6'");
      initSchema(db);

      // journal_mode 是特殊 PRAGMA：SET 时 SQLite 返回新值，可用 simple:true 取单值
      const walMode = db.pragma('journal_mode = WAL', { simple: true });
      harness.equal(walMode, 'wal', 'journal_mode should be wal');

      // foreign_keys / busy_timeout 是普通 SET PRAGMA，不返回数据；
      // 只能通过 readback 验证。better-sqlite3 simple:true 对 SET 返回 undefined。
      db.pragma('foreign_keys = ON');
      const fkCheck = db.pragma('foreign_keys', { simple: true });
      harness.equal(fkCheck, 1, 'foreign_keys should be 1 after enable');

      db.pragma('busy_timeout = 5000');
      const btCheck = db.pragma('busy_timeout', { simple: true });
      harness.equal(btCheck, 5000, 'busy_timeout should be 5000ms after set');

      db.close();
    });

    // ===== Test 7: v0→v1→v2 最小 Migration =====
    await runTraced('migration-v0-to-v2', () => {
      const dbPath = join(fixtureDir, 'migration.db');
      const db = new Database(dbPath);
      db.pragma("key = 'migration-key-7'");
      db.pragma('journal_mode = WAL');
      initSchema(db);
      harness.equal(getSchemaVersion(db), 0, 'schema_version should be 0 after init');

      migrate(db, 1);
      harness.equal(getSchemaVersion(db), 1, 'schema_version should be 1 after migrate to v1');

      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'spike_%' ORDER BY name")
        .all()
        .map((r) => r.name);
      harness.assert(tables.includes('spike_documents'), 'spike_documents should exist after v1');

      migrate(db, 2);
      harness.equal(getSchemaVersion(db), 2, 'schema_version should be 2 after migrate to v2');

      const idxs = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
        .all()
        .map((r) => r.name);
      harness.assert(idxs.includes('idx_spike_documents_created'), 'index should exist after v2');

      assertMigrationsApplied(db, 2);

      db.close();
      const db2 = new Database(dbPath);
      db2.pragma("key = 'migration-key-7'");
      harness.equal(getSchemaVersion(db2), 2, 'schema_version should persist after reopen');
      db2.close();
    });

    // ===== Test 8: Migration 中途强杀，重启后只能见旧版本或完整新版本 =====
    await runTraced('migration-crash-no-half-state', async () => {
      const dbPath = join(fixtureDir, 'migration-crash.db');
      const sentinelPath = join(fixtureDir, 'migration-crash.sentinel');

      const db = new Database(dbPath);
      db.pragma("key = 'crash-key-8'");
      db.pragma('journal_mode = WAL');
      initSchema(db);
      db.close();

      const r = await spawnAndKill({
        dbPath,
        key: 'crash-key-8',
        op: 'migration-v1',
        sentinelPath,
        holdSec: 5,
        killTimeoutMs: 10000,
      });

      harness.assert(r.killed, 'child should have been killed');
      harness.equal(r.signal, 'SIGKILL', 'child should exit with SIGKILL');

      const db2 = new Database(dbPath);
      db2.pragma("key = 'crash-key-8'");
      const sv = getSchemaVersion(db2);
      harness.assert(
        sv === 0,
        `schema_version after crash must be 0 (no half state), got ${sv}`,
        ReasonCode.MIGRATION_CORRUPT,
      );

      const tables = db2
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='spike_documents'")
        .all();
      harness.equal(tables.length, 0, 'spike_documents should NOT exist after crash', ReasonCode.MIGRATION_CORRUPT);

      const ic = db2.prepare('PRAGMA integrity_check').get();
      harness.equal(ic.integrity_check, 'ok', 'integrity_check should be ok after crash');

      db2.close();
    }, { dbPath: '<see test>', sentinelPath: '<see test>' });

    // ===== Test 9: 事务中途 Kill - 未提交数据不可见 =====
    await runTraced('txn-uncommitted-not-visible', async () => {
      const dbPath = join(fixtureDir, 'txn-uncommitted.db');
      const sentinelPath = join(fixtureDir, 'txn-uncommitted.sentinel');

      const db = new Database(dbPath);
      db.pragma("key = 'txn-key-9'");
      db.pragma('journal_mode = WAL');
      initSchema(db);
      migrate(db, 1);
      db.close();

      const r = await spawnAndKill({
        dbPath,
        key: 'txn-key-9',
        op: 'txn-uncommitted',
        sentinelPath,
        holdSec: 5,
        killTimeoutMs: 10000,
      });

      harness.assert(r.killed, 'child should have been killed');

      const db2 = new Database(dbPath);
      db2.pragma("key = 'txn-key-9'");
      const row = db2
        .prepare("SELECT COUNT(*) AS c FROM spike_documents WHERE title = 'uncommitted-title'")
        .get();
      harness.equal(
        row.c,
        0,
        'uncommitted data MUST NOT be visible after crash',
        ReasonCode.CRASH_RECOVERY_FAILED,
      );

      const ic = db2.prepare('PRAGMA integrity_check').get();
      harness.equal(ic.integrity_check, 'ok', 'integrity_check should be ok');
      db2.close();
    });

    // ===== Test 9b: 事务中途 Kill - 已提交数据保留 =====
    await runTraced('txn-committed-preserved', async () => {
      const dbPath = join(fixtureDir, 'txn-committed.db');
      const sentinelPath = join(fixtureDir, 'txn-committed.sentinel');

      const db = new Database(dbPath);
      db.pragma("key = 'txn-key-9b'");
      db.pragma('journal_mode = WAL');
      initSchema(db);
      migrate(db, 1);
      db.close();

      await spawnAndKill({
        dbPath,
        key: 'txn-key-9b',
        op: 'txn-committed',
        sentinelPath,
        holdSec: 0,
        killTimeoutMs: 10000,
      });

      const db2 = new Database(dbPath);
      db2.pragma("key = 'txn-key-9b'");
      const row = db2
        .prepare("SELECT COUNT(*) AS c FROM spike_documents WHERE title = 'committed-title'")
        .get();
      harness.equal(
        row.c,
        1,
        'committed data MUST be preserved after crash',
        ReasonCode.CRASH_RECOVERY_FAILED,
      );
      db2.close();
    });

    // ===== Test 10: 1 写 + 8 并发读 =====
    await runTraced('concurrent-1w-8r', async () => {
      const dbPath = join(fixtureDir, 'concurrent.db');
      const key = 'concurrent-key-10';

      const db = new Database(dbPath);
      db.pragma(`key = '${key}'`);
      db.pragma('journal_mode = WAL');
      db.pragma('busy_timeout = 10000');
      initSchema(db);
      migrate(db, 1);
      db.close();

      const writerIterations = 200;
      const readerIterations = 100;

      const workers = [];
      for (let i = 0; i < 9; i++) {
        const mode = i === 0 ? 'writer' : 'reader';
        const worker = new Worker(join(__dirname, 'lib', 'concurrent-worker.mjs'), {
          workerData: {
            mode,
            dbPath,
            key,
            iterations: mode === 'writer' ? writerIterations : readerIterations,
            workerId: i,
          },
        });
        workers.push(
          new Promise((resolve, reject) => {
            worker.on('message', resolve);
            worker.on('error', reject);
            worker.on('exit', (code) => {
              if (code !== 0) reject(new Error(`worker ${i} exited with code ${code}`));
            });
          }),
        );
      }

      const results = await Promise.all(workers);

      const writerResult = results.find((r) => r.mode === 'writer');
      const readerResults = results.filter((r) => r.mode === 'reader');

      harness.assert(writerResult, 'writer result should exist');
      harness.equal(
        writerResult.success,
        writerIterations,
        `writer should complete all ${writerIterations} INSERTs`,
        ReasonCode.CRASH_RECOVERY_FAILED,
      );
      harness.equal(
        writerResult.errors.length,
        0,
        `writer should have 0 errors, got: ${JSON.stringify(writerResult.errors.slice(0, 3))}`,
      );

      harness.equal(readerResults.length, 8, 'should have 8 readers');
      for (const r of readerResults) {
        harness.assert(
          !r.fatalError,
          `reader ${r.workerId} fatal: ${r.fatalError}`,
          ReasonCode.CRASH_RECOVERY_FAILED,
        );
        const busyErrors = r.errors.filter((e) => e.code === 'SQLITE_BUSY');
        harness.equal(
          busyErrors.length,
          0,
          `reader ${r.workerId} should have 0 SQLITE_BUSY errors, got ${busyErrors.length}`,
          ReasonCode.CRASH_RECOVERY_FAILED,
        );
      }

      const db2 = new Database(dbPath);
      db2.pragma(`key = '${key}'`);
      const cnt = db2.prepare('SELECT COUNT(*) AS c FROM spike_documents').get();
      harness.equal(
        cnt.c,
        writerIterations,
        `final count should equal writer iterations (${writerIterations}), got ${cnt.c}`,
        ReasonCode.CRASH_RECOVERY_FAILED,
      );
      db2.close();
    });

    // ===== Test 11: quick_check + integrity_check 通过 =====
    await runTraced('integrity-checks-pass', () => {
      const dbPath = join(fixtureDir, 'integrity.db');
      const db = new Database(dbPath);
      db.pragma("key = 'integrity-key-11'");
      db.pragma('journal_mode = WAL');
      initSchema(db);
      migrate(db, 2);

      for (let i = 0; i < 100; i++) {
        db.prepare("INSERT INTO spike_documents (title, content, created_at) VALUES (?, ?, ?)")
          .run(`title-${i}`, `content-${i}`, new Date().toISOString());
      }
      db.prepare('INSERT INTO spike_canary (secret) VALUES (?)').run('non-sensitive-data');
      db.pragma('wal_checkpoint(TRUNCATE)');
      db.close();

      const db2 = new Database(dbPath);
      db2.pragma("key = 'integrity-key-11'");
      const qc = db2.prepare('PRAGMA quick_check').get();
      harness.equal(qc.quick_check, 'ok', 'quick_check should be ok');
      const ic = db2.prepare('PRAGMA integrity_check').get();
      harness.equal(ic.integrity_check, 'ok', 'integrity_check should be ok');
      db2.close();
    });

    // ===== Test 12: Crash Recovery 时间与 WAL 大小报告 =====
    await runTraced('crash-recovery-metrics', async () => {
      const dbPath = join(fixtureDir, 'recovery-metrics.db');
      const sentinelPath = join(fixtureDir, 'recovery-metrics.sentinel');

      const db = new Database(dbPath);
      db.pragma("key = 'metrics-key-12'");
      db.pragma('journal_mode = WAL');
      initSchema(db);
      migrate(db, 1);
      for (let i = 0; i < 50; i++) {
        db.prepare("INSERT INTO spike_documents (title, content, created_at) VALUES (?, ?, ?)")
          .run(`pre-${i}`, `content-${i}`, new Date().toISOString());
      }
      db.close();

      const killResult = await spawnAndKill({
        dbPath,
        key: 'metrics-key-12',
        op: 'txn-uncommitted',
        sentinelPath,
        holdSec: 3,
        killTimeoutMs: 10000,
      });

      const walPath = `${dbPath}-wal`;
      const shmPath = `${dbPath}-shm`;
      const walSizeBeforeRecovery = existsSync(walPath) ? statSync(walPath).size : 0;
      const shmSizeBeforeRecovery = existsSync(shmPath) ? statSync(shmPath).size : 0;

      const recoveryStart = Date.now();
      const db2 = new Database(dbPath);
      db2.pragma("key = 'metrics-key-12'");
      db2.pragma('journal_mode = WAL');
      db2.prepare('SELECT COUNT(*) AS c FROM spike_documents').get();
      const recoveryDurationMs = Date.now() - recoveryStart;

      const cnt = db2.prepare('SELECT COUNT(*) AS c FROM spike_documents').get();
      harness.equal(cnt.c, 50, 'pre-crash data should be preserved (50 rows)');

      db2.pragma('wal_checkpoint(TRUNCATE)');
      const walSizeAfterCheckpoint = existsSync(walPath) ? statSync(walPath).size : 0;
      db2.close();

      harness.environment.recoveryMetrics = {
        killDurationMs: killResult.killDurationMs,
        walSizeBeforeRecoveryBytes: walSizeBeforeRecovery,
        shmSizeBeforeRecoveryBytes: shmSizeBeforeRecovery,
        recoveryDurationMs,
        walSizeAfterCheckpointBytes: walSizeAfterCheckpoint,
        guardrailRecoverySec: 5,
        guardrailMet: recoveryDurationMs <= 5000,
      };

      harness.assert(
        recoveryDurationMs <= 5000,
        `Crash recovery should be <= 5000ms, got ${recoveryDurationMs}ms (guardrail=5s)`,
        ReasonCode.GUARDRAIL_PERF,
      );
    });

    const result = harness.finish();
    Harness.printSummary(result);
    process.exitCode = result.exitCode;
  } catch (e) {
    console.error('FATAL: error in 02-b main:', e);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('FATAL: uncaught error in 02-b:', err);
  process.exitCode = 1;
}).finally(() => {
  if (fixtureDir) cleanupFixtureDir(fixtureDir);
});

process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason);
  process.exit(13);
});
