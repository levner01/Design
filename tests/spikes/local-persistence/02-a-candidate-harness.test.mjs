#!/usr/bin/env node
/**
 * M0-02 02-A：候选与 Harness
 *
 * 验证主候选（better-sqlite3-multiple-ciphers@12.11.1 + sqlite-vec@0.1.9）的：
 *   1. 驱动可被 import 加载
 *   2. sqlite_version() = 3.53.2
 *   3. PRAGMA compile_options 包含 ENABLE_FTS5、DEFAULT_FOREIGN_KEYS、THREADSAFE=2
 *   4. FTS5 virtual table 可创建/插入/查询
 *   5. db.loadExtension(vecPath) 可加载 sqlite-vec
 *   6. vec_version() = v0.1.9
 *   7. vec0 virtual table 可创建/插入（BigInt rowid）/查询/删除
 *   8. 错误 Key 抛 'file is not a database'
 *   9. DB 头 16 字节不等于 'SQLite format 3\0'
 *   10. sqlite-vec 平台子包路径真实存在
 *
 * 退出码：0=全部 PASS，1=任一 FAIL
 * 报告：tests/spikes/local-persistence/run/02-a-candidate-harness.json
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Harness } from './lib/harness.mjs';
import { ReasonCode } from './lib/reason-codes.mjs';
import {
  probeAll,
  getDriverInfo,
  getVecInfo,
  resolveVecLoadablePath,
  resolveDriverNativePath,
} from './lib/env.mjs';
import { createFixtureDir, cleanupFixtureDir, CANARY_TOKEN } from './lib/fixture.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');

// Spike 依赖声明在 apps/desktop/package.json，必须从那里解析（防止根 package.json 意外引入生产代码）。
const desktopRequire = createRequire(join(REPO_ROOT, 'apps/desktop', 'package.json'));
const Database = desktopRequire('better-sqlite3-multiple-ciphers');

const harness = new Harness('02-a-candidate-harness', {
  reportName: '02-a-candidate-harness',
});

let fixtureDir;

async function main() {
  // 探测环境（用于报告）
  const probeDb = new Database(':memory:');
  const envSnapshot = probeAll(probeDb);
  probeDb.close();
  harness.environment = envSnapshot;

  // 创建临时 Fixture 目录
  fixtureDir = createFixtureDir('02a');

  // ===== Test 1: 驱动可被 import 加载 =====
  await harness.run('driver-import', () => {
    harness.assert(typeof Database === 'function', 'Database should be a constructor class');
    const info = getDriverInfo();
    harness.equal(info.name, 'better-sqlite3-multiple-ciphers', 'driver package name');
    harness.equal(info.version, '12.11.1', 'driver version pinned');
    harness.equal(info.license, 'MIT', 'driver license');
  });

  // ===== Test 2: sqlite_version() = 3.53.2 =====
  await harness.run('sqlite-version', () => {
    const db = new Database(':memory:');
    const v = db.prepare('SELECT sqlite_version() AS v').get().v;
    harness.equal(v, '3.53.2', 'sqlite_version() must be 3.53.2', ReasonCode.DRIVER_LOAD_FAILED);
    db.close();
  });

  // ===== Test 3: PRAGMA compile_options 关键项 =====
  await harness.run('compile-options', () => {
    const db = new Database(':memory:');
    const options = db.prepare('PRAGMA compile_options').all().map((r) => r.compile_options);
    harness.assert(options.includes('ENABLE_FTS5'), 'ENABLE_FTS5 missing', ReasonCode.DRIVER_LOAD_FAILED);
    harness.assert(options.includes('DEFAULT_FOREIGN_KEYS'), 'DEFAULT_FOREIGN_KEYS missing', ReasonCode.DRIVER_LOAD_FAILED);
    harness.assert(options.includes('THREADSAFE=2'), 'THREADSAFE=2 missing', ReasonCode.DRIVER_LOAD_FAILED);
    harness.assert(options.includes('OMIT_SHARED_CACHE'), 'OMIT_SHARED_CACHE missing', ReasonCode.DRIVER_LOAD_FAILED);
    harness.assert(options.some((o) => o.startsWith('COMPILER=')), 'COMPILER missing', ReasonCode.DRIVER_LOAD_FAILED);
    db.close();
  });

  // ===== Test 4: FTS5 virtual table 可创建/插入/查询 =====
  await harness.run('fts5-basic', () => {
    const db = new Database(':memory:');
    db.exec('CREATE VIRTUAL TABLE fts_test USING fts5(content)');
    db.prepare('INSERT INTO fts_test(content) VALUES (?)').run('hello world');
    db.prepare('INSERT INTO fts_test(content) VALUES (?)').run('designwan persistence spike');
    const rows = db.prepare("SELECT content FROM fts_test WHERE fts_test MATCH 'hello'").all();
    harness.equal(rows.length, 1, 'FTS5 MATCH should return 1 row', ReasonCode.DRIVER_LOAD_FAILED);
    harness.equal(rows[0].content, 'hello world', 'FTS5 MATCH content mismatch');
    db.close();
  });

  // ===== Test 5: db.loadExtension 加载 sqlite-vec =====
  await harness.run('vec-load', () => {
    const db = new Database(':memory:');
    const vecPath = resolveVecLoadablePath();
    harness.assert(existsSync(vecPath), `vec0 extension file not found at ${vecPath}`, ReasonCode.VEC_LOAD_FAILED);
    const stat = statSync(vecPath);
    harness.assert(stat.size > 1000, `vec0 extension too small: ${stat.size} bytes`, ReasonCode.VEC_LOAD_FAILED);
    db.loadExtension(vecPath);
    const v = db.prepare('SELECT vec_version() AS v').get().v;
    harness.equal(v, 'v0.1.9', 'vec_version() must be v0.1.9', ReasonCode.VEC_LOAD_FAILED);
    db.close();
  });

  // ===== Test 6: sqlite-vec 包信息与许可证 =====
  await harness.run('vec-package-info', () => {
    const info = getVecInfo();
    harness.equal(info.name, 'sqlite-vec', 'vec package name');
    harness.equal(info.version, '0.1.9', 'vec package version pinned');
    harness.assert(
      info.license === 'MIT OR Apache' || info.license === 'Apache-2.0' || info.license === 'MIT',
      `vec license should permit closed-source beta (got: ${info.license})`,
      ReasonCode.LICENSE_BLOCKED,
    );
  });

  // ===== Test 7: vec0 CRUD（BigInt rowid） =====
  await harness.run('vec0-crud', () => {
    const db = new Database(':memory:');
    db.defaultSafeIntegers = true; // 关键：vec0 0.1.9 要求 rowid 为 BigInt
    db.loadExtension(resolveVecLoadablePath());
    db.exec('CREATE VIRTUAL TABLE vec_demo USING vec0(embedding float[4])');
    const ins = db.prepare('INSERT INTO vec_demo(rowid, embedding) VALUES (?, ?)');
    ins.run(BigInt(1), new Float32Array([1.0, 2.0, 3.0, 4.0]));
    ins.run(BigInt(2), new Float32Array([5.0, 6.0, 7.0, 8.0]));
    ins.run(BigInt(3), new Float32Array([1.5, 2.5, 3.5, 4.5]));

    // 查询向量更靠近 rowid=1，避免 tie 导致的次序歧义
    // rowid=1: L2^2 = 4 * 0.0001 = 0.0004
    // rowid=3: L2^2 = 4 * 0.2025 = 0.81
    const r = db
      .prepare('SELECT rowid, distance FROM vec_demo WHERE embedding MATCH ? ORDER BY distance LIMIT 1')
      .all(new Float32Array([1.01, 2.01, 3.01, 4.01]));
    harness.equal(r.length, 1, 'vec0 Top-1 should return 1 row', ReasonCode.VEC_LOAD_FAILED);
    harness.equal(Number(r[0].rowid), 1, 'vec0 Top-1 rowid should be 1', ReasonCode.VEC_LOAD_FAILED);

    db.prepare('DELETE FROM vec_demo WHERE rowid = ?').run(BigInt(1));
    const after = db
      .prepare('SELECT rowid FROM vec_demo WHERE embedding MATCH ? ORDER BY distance LIMIT 5')
      .all(new Float32Array([1.0, 2.0, 3.0, 4.0]));
    harness.assert(
      after.every((row) => Number(row.rowid) !== 1),
      'vec0 after DELETE rowid=1 should not return 1',
      ReasonCode.VEC_DELETE_FAILED,
    );
    db.close();
  });

  // ===== Test 8: 加密 - 正确 Key 创建与重开 =====
  await harness.run('encryption-correct-key', () => {
    const dbPath = join(fixtureDir, 'enc-correct.db');
    const db = new Database(dbPath);
    db.pragma("key = 'correct-key-12345'");
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
    db.prepare('INSERT INTO t (v) VALUES (?)').run('hello-encrypted');
    db.close();

    const db2 = new Database(dbPath);
    db2.pragma("key = 'correct-key-12345'");
    const rows = db2.prepare('SELECT * FROM t').all();
    harness.equal(rows.length, 1, 'correct key should read 1 row', ReasonCode.ENCRYPTION_DISABLED);
    harness.equal(rows[0].v, 'hello-encrypted', 'correct key content mismatch', ReasonCode.ENCRYPTION_DISABLED);
    db2.close();
  });

  // ===== Test 9: 加密 - 错误 Key 稳定失败 =====
  await harness.run('encryption-wrong-key', () => {
    const dbPath = join(fixtureDir, 'enc-wrongkey.db');
    // 先用正确 Key 创建
    const db = new Database(dbPath);
    db.pragma("key = 'correct-key-12345'");
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
    db.prepare('INSERT INTO t (v) VALUES (?)').run('canary-data');
    db.close();

    // 错误 Key 重开
    let wrongKeyAccepted = false;
    try {
      const db2 = new Database(dbPath);
      db2.pragma("key = 'wrong-key-xxx'");
      // 用错误 Key 尝试查询
      db2.prepare('SELECT * FROM t').all();
      wrongKeyAccepted = true;
      db2.close();
    } catch (e) {
      harness.assert(
        String(e.message).includes('not a database') || String(e.message).includes('file is not'),
        `wrong key should reject with 'not a database', got: ${e.message}`,
        ReasonCode.WRONG_KEY_ACCEPTED,
      );
    }
    harness.assert(!wrongKeyAccepted, 'wrong key must NOT be accepted', ReasonCode.WRONG_KEY_ACCEPTED);
  });

  // ===== Test 10: 加密 - 错误 Key 不得新建/截断/覆盖原库 =====
  await harness.run('encryption-wrong-key-no-corruption', () => {
    const dbPath = join(fixtureDir, 'enc-no-corrupt.db');
    const db = new Database(dbPath);
    db.pragma("key = 'correct-key-12345'");
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
    db.prepare('INSERT INTO t (v) VALUES (?)').run('preserved-data');
    db.close();

    const originalSize = statSync(dbPath).size;
    harness.assert(originalSize > 0, 'original DB should have non-zero size');

    // 用错误 Key 尝试打开
    try {
      const db2 = new Database(dbPath);
      db2.pragma("key = 'wrong-key-yyy'");
      db2.prepare('SELECT * FROM t').all();
      db2.close();
    } catch (e) {
      // 预期失败
    }

    // 验证文件大小未变（不应被截断或覆盖）
    const afterSize = statSync(dbPath).size;
    harness.equal(afterSize, originalSize, 'wrong key must NOT change DB file size', ReasonCode.WRONG_KEY_ACCEPTED);

    // 正确 Key 仍可读
    const db3 = new Database(dbPath);
    db3.pragma("key = 'correct-key-12345'");
    const rows = db3.prepare('SELECT * FROM t').all();
    harness.equal(rows.length, 1, 'correct key should still read data after wrong-key attempt');
    harness.equal(rows[0].v, 'preserved-data', 'data should be preserved');
    db3.close();
  });

  // ===== Test 11: DB 头不出现 'SQLite format 3' 明文 =====
  await harness.run('db-header-encrypted', () => {
    const dbPath = join(fixtureDir, 'enc-header.db');
    const db = new Database(dbPath);
    db.pragma("key = 'header-test-key'");
    db.exec('CREATE TABLE t (v TEXT)');
    db.close();

    const buf = readFileSync(dbPath);
    const header = buf.subarray(0, 16).toString('utf8');
    harness.assert(
      !header.includes('SQLite format 3'),
      `DB header must NOT contain 'SQLite format 3' (got: ${JSON.stringify(header.slice(0, 16))})`,
      ReasonCode.PLAINTEXT_LEAK,
    );

    // 验证前 16 字节都是非可读字符（加密后应随机化）
    let printableCount = 0;
    for (let i = 0; i < 16; i++) {
      const c = buf[i];
      if (c >= 0x20 && c <= 0x7e) printableCount++;
    }
    // 加密 header 不会全部可读，但允许少数可读字节（不能要求 0 个可读字符，过于严格）
    harness.assert(printableCount < 16, 'DB header should not be all printable ASCII', ReasonCode.PLAINTEXT_LEAK);
  });

  // ===== Test 12: Canary 不出现在 DB 文件明文中 =====
  await harness.run('canary-not-plaintext', () => {
    const dbPath = join(fixtureDir, 'enc-canary.db');
    const db = new Database(dbPath);
    db.pragma("key = 'canary-test-key'");
    db.exec('CREATE TABLE secrets (v TEXT)');
    db.prepare('INSERT INTO secrets (v) VALUES (?)').run(CANARY_TOKEN);
    db.close();

    const buf = readFileSync(dbPath);
    const content = buf.toString('utf8');
    harness.assert(
      !content.includes(CANARY_TOKEN),
      `Canary token MUST NOT appear as plaintext in DB file`,
      ReasonCode.PLAINTEXT_LEAK,
    );
  });

  // ===== Test 13: 平台子包路径真实存在 =====
  await harness.run('vec-platform-binary-exists', () => {
    const vecPath = resolveVecLoadablePath();
    harness.assert(existsSync(vecPath), `platform vec0 binary must exist at ${vecPath}`, ReasonCode.VEC_LOAD_FAILED);
    const stat = statSync(vecPath);
    harness.assert(stat.size > 10000, `vec0 binary too small: ${stat.size} bytes`, ReasonCode.VEC_LOAD_FAILED);
  });

  // ===== Test 14: Driver native .node 路径真实存在（asarUnpack 用） =====
  await harness.run('driver-native-binary-exists', () => {
    const nodePath = resolveDriverNativePath();
    harness.assert(existsSync(nodePath), `driver .node must exist at ${nodePath}`, ReasonCode.DRIVER_LOAD_FAILED);
    const stat = statSync(nodePath);
    harness.assert(stat.size > 100000, `driver .node too small: ${stat.size} bytes`, ReasonCode.DRIVER_LOAD_FAILED);
  });

  // ===== Test 15: vec0 函数列表（用于 02-C Oracle 接入） =====
  await harness.run('vec-functions-list', () => {
    const db = new Database(':memory:');
    db.loadExtension(resolveVecLoadablePath());
    const fns = db
      .prepare("SELECT name FROM pragma_function_list WHERE name LIKE 'vec%' ORDER BY name")
      .all()
      .map((r) => r.name);
    const expected = ['vec_distance_l2', 'vec_to_json', 'vec_version'];
    for (const name of expected) {
      harness.assert(fns.includes(name), `expected vec function ${name} missing`, ReasonCode.VEC_LOAD_FAILED);
    }
    db.close();
  });

  const result = harness.finish();
  Harness.printSummary(result);
  process.exitCode = result.exitCode;
}

main().catch((err) => {
  console.error('FATAL: uncaught error in 02-a-candidate-harness:', err);
  process.exitCode = 1;
}).finally(() => {
  if (fixtureDir) cleanupFixtureDir(fixtureDir);
});
