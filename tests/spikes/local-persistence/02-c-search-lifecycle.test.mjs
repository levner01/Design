#!/usr/bin/env node
/**
 * M0-02 02-C：FTS5、sqlite-vec 与删除生命周期
 *
 * 覆盖 m2-02.md §四 02-C 全部验收点：
 *
 * FTS5 必须：
 *   1. 创建
 *   2. 批量插入 10k
 *   3. 中文/英文/混合查询
 *   4. 更新
 *   5. 删除
 *   6. rebuild/optimize
 *   7. 删除后命中为 0
 *
 * sqlite-vec 必须：
 *   8. 原生 Extension 真实加载
 *   9. 输出 sqlite-vec 版本
 *   10. vec0 批量插入 10k
 *   11. Top-K 查询
 *   12. 过滤查询
 *   13. 删除
 *   14. 100% 清空
 *   15. 重建
 *   16. 删除后旧 ID 不得再次出现
 *
 * Exact Oracle：
 *   17. 对冻结 Fixture 的 Top-10 一致性比较（tie 按 rowid 升序）
 *
 * 性能门：
 *   18. 10k Fixture 构建 ≤ 120s
 *   19. FTS Top-20 × 100 查询，p95 ≤ 250ms
 *   20. Vector Top-10 × 100 查询，p95 ≤ 250ms
 *   21. 报告 DB、WAL、扩展体积
 *
 * 退出码：0=全部 PASS，1=任一 FAIL
 * 报告：tests/spikes/local-persistence/run/02-c-search-lifecycle.json
 */

import { existsSync, statSync, writeSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Harness } from './lib/harness.mjs';
import { ReasonCode } from './lib/reason-codes.mjs';
import {
  getDriverInfo,
  getSqliteVersion,
  getCompileOptions,
  resolveVecLoadablePath,
} from './lib/env.mjs';
import {
  createFixtureDir,
  cleanupFixtureDir,
  build10kFixture,
  build768Vector,
  buildText,
  VECTOR_DIM,
} from './lib/fixture.mjs';
import { exactTopK, compareTopK, percentiles } from './lib/exact-oracle.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const DESKTOP_PKG = join(REPO_ROOT, 'apps', 'desktop', 'package.json');
const require = createRequire(DESKTOP_PKG);
const Database = require('better-sqlite3-multiple-ciphers');

// pipe 输出时 console 会被块缓冲，诊断用 writeSync(2, ...) 强制无缓冲。
// 默认 off，提交时保留 trace 调用不影响生产。
const DIAG = process.env.SPIKE_DIAG === '1';
function trace(msg) {
  if (DIAG) writeSync(2, `[02-c] ${msg}\n`);
}

const harness = new Harness('02-c-search-lifecycle', {
  reportName: '02-c-search-lifecycle',
});

// 可删除集合：id 1000-1099（100 条），用于 FTS5/vec0 删除生命周期测试
const DELETABLE_IDS = Array.from({ length: 100 }, (_, i) => 1000 + i);
const FIXTURE_COUNT = 10000;
const PERF_QUERIES = 100;
const FTS_GUARDRAIL_P95_MS = 250;
const VEC_GUARDRAIL_P95_MS = 250;
const FIXTURE_BUILD_GUARDRAIL_SEC = 120;

let fixtureDir;

// 包装 harness.run，在每个测试前后输出无缓冲 trace，定位卡点
async function runTraced(name, fn, ctx) {
  trace(`--> ${name}`);
  const r = await harness.run(name, fn, ctx);
  trace(`<-- ${name} ok=${r.ok} dur=${r.durationMs}ms reason=${r.reasonCode ?? '-'}`);
  if (!r.ok) trace(`    msg=${r.message}`);
  return r;
}

/**
 * 打开加密 DB 并加载 sqlite-vec 扩展。
 * @param {string} dbPath
 * @param {string} key
 * @returns {import('better-sqlite3-multiple-ciphers').Database}
 */
function openEncryptedVecDb(dbPath, key) {
  const db = new Database(dbPath);
  db.pragma(`key = '${key.replace(/'/g, "''")}'`);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 10000');
  db.pragma('foreign_keys = ON');
  // vec0 0.1.9 要求 rowid 为 BigInt
  db.defaultSafeIntegers = true;
  db.loadExtension(resolveVecLoadablePath());
  return db;
}

async function main() {
  trace('main entered');

  try {
    // 环境快照
    const probeDb = new Database(':memory:');
    probeDb.loadExtension(resolveVecLoadablePath());
    harness.environment = {
      driver: getDriverInfo(),
      sqlite: {
        version: getSqliteVersion(probeDb),
        compileOptions: getCompileOptions(probeDb),
      },
      vecLoadablePath: resolveVecLoadablePath(),
      fixtureCount: FIXTURE_COUNT,
      deletableIds: DELETABLE_IDS,
      guardrails: {
        fixtureBuildSec: FIXTURE_BUILD_GUARDRAIL_SEC,
        ftsP95Ms: FTS_GUARDRAIL_P95_MS,
        vecP95Ms: VEC_GUARDRAIL_P95_MS,
        perfQueries: PERF_QUERIES,
      },
    };
    probeDb.close();

    fixtureDir = createFixtureDir('02c');

    // 冻结 Fixture：构建一次，全测试共享
    const fixtureBuildStart = Date.now();
    const fixture = build10kFixture({ count: FIXTURE_COUNT });
    const fixtureBuildMs = Date.now() - fixtureBuildStart;
    harness.environment.fixtureBuildMs = fixtureBuildMs;

    // ===== Test 1: 10k Fixture 构建性能门（≤120s） =====
    await runTraced('fixture-build-guardrail', () => {
      harness.equal(fixture.length, FIXTURE_COUNT, 'fixture should have 10k items');
      harness.assert(
        fixtureBuildMs <= FIXTURE_BUILD_GUARDRAIL_SEC * 1000,
        `Fixture build should be <= ${FIXTURE_BUILD_GUARDRAIL_SEC}s, got ${fixtureBuildMs}ms`,
        ReasonCode.GUARDRAIL_PERF,
      );
      // 验证 fixture 确定性：同一 id 必须产生同一向量
      const v1 = build768Vector(42);
      const v2 = build768Vector(42);
      harness.equal(v1.length, VECTOR_DIM, 'vector dim should be 768');
      let allEqual = true;
      for (let i = 0; i < VECTOR_DIM; i++) {
        if (v1[i] !== v2[i]) {
          allEqual = false;
          break;
        }
      }
      harness.assert(allEqual, 'build768Vector must be deterministic for same id');
    });

    // 02-C 主 DB：加密 + WAL + sqlite-vec 加载
    const dbPath = join(fixtureDir, '02c-search.db');
    const db = openEncryptedVecDb(dbPath, '02c-search-key');

    // ===== FTS5 生命周期 =====

    // ===== Test 2: FTS5 创建 + 批量插入 10k =====
    // trigram tokenizer（SQLite 3.34+）：3-gram 滑窗分词，对 CJK 友好。
    // unicode61 对 CJK 按单字符分词，MATCH '品牌' 在 FTS5 语法里被解析为
    // '品 AND 牌'，且中文 token 需双引号包裹，体验糟糕。trigram 唯一约束：
    // 查询词必须 ≥3 字符（中文 ≥3 字、英文 ≥3 字符）。
    await runTraced('fts5-create-and-bulk-insert', () => {
      db.exec(`
        CREATE VIRTUAL TABLE spike_fts USING fts5(
          doc_id UNINDEXED,
          text,
          type UNINDEXED,
          tokenize = 'trigram'
        );
      `);
      const ins = db.prepare(
        'INSERT INTO spike_fts(rowid, doc_id, text, type) VALUES (?, ?, ?, ?)',
      );
      const tx = db.transaction((items) => {
        for (const item of items) {
          ins.run(BigInt(item.id), item.id, item.text, item.type);
        }
      });
      tx(fixture);

      const cnt = db.prepare('SELECT COUNT(*) AS c FROM spike_fts').get();
      harness.equal(Number(cnt.c), FIXTURE_COUNT, 'FTS5 should have 10k rows');
    });

    // ===== Test 3: FTS5 中文查询 =====
    // trigram 要求查询词 ≥3 字符。"品牌视觉" 4 字符 → 2 个 3-gram "品牌视"、"牌视觉"。
    // ZH_POOL 第一条 "品牌视觉系统在多场景下的延展性研究" 同时包含这两个 3-gram，会命中。
    await runTraced('fts5-chinese-query', () => {
      const rows = db
        .prepare("SELECT doc_id FROM spike_fts WHERE spike_fts MATCH '品牌视觉' ORDER BY rank LIMIT 20")
        .all();
      harness.assert(rows.length > 0, 'FTS5 Chinese MATCH should return > 0 rows', ReasonCode.FTS_DELETE_FAILED);
      // 验证返回的都是中文或混合类型（id % 3 === 0 是 zh, id % 3 === 2 是 mixed）
      for (const r of rows) {
        const id = Number(r.doc_id);
        harness.assert(
          id % 3 === 0 || id % 3 === 2,
          `Chinese MATCH should return zh/mixed docs, got id=${id} (type=${id % 3})`,
        );
      }
    });

    // ===== Test 4: FTS5 英文查询 =====
    await runTraced('fts5-english-query', () => {
      const rows = db
        .prepare("SELECT doc_id FROM spike_fts WHERE spike_fts MATCH 'visual' ORDER BY rank LIMIT 20")
        .all();
      harness.assert(rows.length > 0, 'FTS5 English MATCH should return > 0 rows', ReasonCode.FTS_DELETE_FAILED);
      for (const r of rows) {
        const id = Number(r.doc_id);
        harness.assert(
          id % 3 === 1 || id % 3 === 2,
          `English MATCH should return en/mixed docs, got id=${id}`,
        );
      }
    });

    // ===== Test 5: FTS5 混合查询（中英组合） =====
    // trigram 模式下空格是隐式 AND：'视觉系 visual' 要求文档同时包含
    // "视觉系" 3-gram 和 "vis"/"isua"... 等 visual 的 3-gram。
    // 10k fixture 中 mixed 文档约 3333 条，其中 ZH_POOL 选第一条（含"视觉系"）
    // 且 EN_POOL 选第一条（含"visual"）的 mixed 文档应 > 0 条。
    await runTraced('fts5-mixed-query', () => {
      const rows = db
        .prepare("SELECT doc_id FROM spike_fts WHERE spike_fts MATCH '视觉系 visual' ORDER BY rank LIMIT 20")
        .all();
      harness.assert(rows.length > 0, 'FTS5 mixed MATCH should return > 0 rows', ReasonCode.FTS_DELETE_FAILED);
      // mixed 类型（id % 3 === 2）应占多数
      let mixedCount = 0;
      for (const r of rows) {
        if (Number(r.doc_id) % 3 === 2) mixedCount++;
      }
      harness.assert(
        mixedCount > 0,
        `FTS5 mixed MATCH should return at least 1 mixed doc, got ${mixedCount}/${rows.length}`,
        ReasonCode.FTS_DELETE_FAILED,
      );
    });

    // ===== Test 6: FTS5 更新（DELETE + INSERT 模拟） =====
    // 注意：FTS5 查询语法中 `-` 是 NOT 操作符，`MATCH 'UPDATED-FTS-MARKER'` 会被
    // 解析为 `UPDATED NOT FTS NOT MARKER`。下划线是合法 token 字符，不会被解析为
    // 操作符，更稳妥。若必须用连字符，需用双引号包裹 `MATCH '"UPDATED-FTS-MARKER"'`。
    await runTraced('fts5-update', () => {
      const targetId = 500;
      // 原始文本
      const before = db
        .prepare('SELECT text FROM spike_fts WHERE doc_id = ?')
        .get(targetId);
      harness.assert(!!before, 'doc 500 should exist before update');

      // 删除原记录
      db.prepare('DELETE FROM spike_fts WHERE doc_id = ?').run(targetId);
      // 插入新文本（带特殊标记，用下划线避免 FTS5 NOT 操作符）
      const newText = 'UPDATED_FTS_MARKER_7f3a ' + buildText(targetId, 'en');
      db.prepare('INSERT INTO spike_fts(rowid, doc_id, text, type) VALUES (?, ?, ?, ?)')
        .run(BigInt(targetId), targetId, newText, 'en');

      // 查询应命中新文本（用双引号包裹 token 是 phrase query，更精确）
      const rows = db
        .prepare("SELECT doc_id FROM spike_fts WHERE spike_fts MATCH 'UPDATED_FTS_MARKER_7f3a'")
        .all();
      harness.equal(rows.length, 1, 'FTS5 update should make new text searchable', ReasonCode.FTS_DELETE_FAILED);
      harness.equal(Number(rows[0].doc_id), targetId, 'updated doc_id should match');
    });

    // ===== Test 7: FTS5 删除 + 删除后命中为 0 =====
    await runTraced('fts5-delete-zero-hit', () => {
      // 删除可删除集合 1000-1099
      const del = db.prepare('DELETE FROM spike_fts WHERE doc_id = ?');
      const tx = db.transaction((ids) => {
        for (const id of ids) del.run(id);
      });
      tx(DELETABLE_IDS);

      // 验证删除后这些 id 不再被 MATCH 命中
      // "品牌视觉" 仍可命中其他 id（zh/mixed 全库都有），但被 doc_id 范围过滤后应为 0。
      const rows = db
        .prepare("SELECT doc_id FROM spike_fts WHERE spike_fts MATCH '品牌视觉' AND doc_id >= 1000 AND doc_id <= 1099")
        .all();
      harness.equal(
        rows.length,
        0,
        'FTS5 deleted docs must not be hit (1000-1099)',
        ReasonCode.FTS_DELETE_FAILED,
      );

      // 总数应减少 100
      const cnt = db.prepare('SELECT COUNT(*) AS c FROM spike_fts').get();
      harness.equal(
        Number(cnt.c),
        FIXTURE_COUNT - DELETABLE_IDS.length,
        'FTS5 count should decrease by 100 after deletion',
        ReasonCode.FTS_DELETE_FAILED,
      );
    });

    // ===== Test 8: FTS5 rebuild + optimize =====
    await runTraced('fts5-rebuild-optimize', () => {
      // rebuild：重建 FTS 索引结构（用于 external content 同步，这里验证不报错）
      db.exec("INSERT INTO spike_fts(spike_fts) VALUES('rebuild')");
      // optimize：合并索引段
      db.exec("INSERT INTO spike_fts(spike_fts) VALUES('optimize')");

      // rebuild/optimize 后查询仍然正常
      const rows = db
        .prepare("SELECT doc_id FROM spike_fts WHERE spike_fts MATCH 'visual' ORDER BY rank LIMIT 5")
        .all();
      harness.assert(rows.length > 0, 'FTS5 should still return results after rebuild/optimize', ReasonCode.FTS_DELETE_FAILED);
    });

    // ===== sqlite-vec 生命周期 =====

    // ===== Test 9: sqlite-vec 加载与版本 =====
    await runTraced('vec-load-and-version', () => {
      // DB 已经在 openEncryptedVecDb 里加载了 vec0
      const v = db.prepare('SELECT vec_version() AS v').get().v;
      harness.equal(v, 'v0.1.9', 'vec_version() must be v0.1.9', ReasonCode.VEC_LOAD_FAILED);

      // 验证关键 vec 函数存在
      const fns = db
        .prepare("SELECT name FROM pragma_function_list WHERE name LIKE 'vec%' ORDER BY name")
        .all()
        .map((r) => r.name);
      const required = ['vec_distance_l2', 'vec_distance_cosine', 'vec_version', 'vec_to_json'];
      for (const name of required) {
        harness.assert(fns.includes(name), `vec function ${name} missing`, ReasonCode.VEC_LOAD_FAILED);
      }
    });

    // ===== Test 10: vec0 批量插入 10k =====
    await runTraced('vec-bulk-insert-10k', () => {
      db.exec(`
        CREATE VIRTUAL TABLE spike_vec USING vec0(
          embedding float[${VECTOR_DIM}]
        );
      `);
      const ins = db.prepare('INSERT INTO spike_vec(rowid, embedding) VALUES (?, ?)');
      const tx = db.transaction((items) => {
        for (const item of items) {
          ins.run(BigInt(item.id), item.vector);
        }
      });
      tx(fixture);

      const cnt = db.prepare('SELECT COUNT(*) AS c FROM spike_vec').get();
      harness.equal(Number(cnt.c), FIXTURE_COUNT, 'vec0 should have 10k rows', ReasonCode.VEC_LOAD_FAILED);
    });

    // ===== Test 11: vec0 Top-K 查询 =====
    await runTraced('vec-topk-query', () => {
      // 用 id=1 的向量查询，Top-1 应该是 id=1 自己（distance=0）
      const queryVec = build768Vector(1);
      const rows = db
        .prepare('SELECT rowid, distance FROM spike_vec WHERE embedding MATCH ? ORDER BY distance LIMIT 10')
        .all(queryVec);
      harness.equal(rows.length, 10, 'vec0 Top-10 should return 10 rows', ReasonCode.VEC_LOAD_FAILED);
      // Top-1 应该是 id=1，distance ≈ 0
      harness.equal(Number(rows[0].rowid), 1, 'vec0 Top-1 should be id=1 (self)', ReasonCode.VEC_LOAD_FAILED);
      harness.assert(
        rows[0].distance < 1e-4,
        `vec0 self-distance should be ~0, got ${rows[0].distance}`,
        ReasonCode.VEC_LOAD_FAILED,
      );
      // distance 应该单调递增
      for (let i = 1; i < rows.length; i++) {
        harness.assert(
          rows[i].distance >= rows[i - 1].distance - 1e-6,
          `vec0 distance should be non-decreasing at rank ${i}`,
        );
      }
    });

    // ===== Test 12: vec0 过滤查询 =====
    // vec0 0.1.9 不支持 KNN 查询中 `rowid >= ? AND rowid < ?` 范围过滤，
    // 错误：A LIMIT or 'k = ?' constraint is required on vec0 knn queries。
    // 替代方案：用辅助表 + `rowid IN (SELECT id FROM spike_filter_ids)`。
    // 参考：https://github.com/asg017/sqlite-vec#knn-queries
    await runTraced('vec-filter-query', () => {
      // 构造过滤集合：id 在 [2000, 2100) 范围内
      db.exec('CREATE TABLE IF NOT EXISTS spike_filter_ids (id INTEGER PRIMARY KEY)');
      db.exec('DELETE FROM spike_filter_ids');
      const filterIds = Array.from({ length: 100 }, (_, i) => 2000 + i);
      const insFilter = db.prepare('INSERT INTO spike_filter_ids (id) VALUES (?)');
      const txFilter = db.transaction((ids) => {
        for (const id of ids) insFilter.run(id);
      });
      txFilter(filterIds);

      // 用 id=2050 的向量查询，Top-5 应该都在 [2000, 2100) 范围内
      const queryVec = build768Vector(2050);
      const rows = db
        .prepare(
          `SELECT v.rowid, v.distance FROM spike_vec v
           WHERE v.embedding MATCH ?
             AND v.rowid IN (SELECT id FROM spike_filter_ids)
           ORDER BY v.distance LIMIT 5`,
        )
        .all(queryVec);
      harness.assert(rows.length > 0, 'vec0 filter query should return rows', ReasonCode.VEC_LOAD_FAILED);
      harness.assert(rows.length <= 5, 'vec0 filter query should return <= 5 rows');
      for (const r of rows) {
        const id = Number(r.rowid);
        harness.assert(
          id >= 2000 && id < 2100,
          `vec0 filter result id=${id} out of [2000, 2100)`,
          ReasonCode.VEC_LOAD_FAILED,
        );
      }
      // Top-1 应该是 id=2050 自己（distance ≈ 0）
      harness.equal(
        Number(rows[0].rowid),
        2050,
        'vec0 filter Top-1 should be id=2050 (self)',
        ReasonCode.VEC_LOAD_FAILED,
      );
      harness.assert(
        rows[0].distance < 1e-4,
        `vec0 filter self-distance should be ~0, got ${rows[0].distance}`,
        ReasonCode.VEC_LOAD_FAILED,
      );
    });

    // ===== Test 13: vec0 删除 + 删除后旧 ID 不再出现 =====
    await runTraced('vec-delete-and-not-return', () => {
      // 删除可删除集合 1000-1099
      const del = db.prepare('DELETE FROM spike_vec WHERE rowid = ?');
      const tx = db.transaction((ids) => {
        for (const id of ids) del.run(BigInt(id));
      });
      tx(DELETABLE_IDS);

      const cnt = db.prepare('SELECT COUNT(*) AS c FROM spike_vec').get();
      harness.equal(
        Number(cnt.c),
        FIXTURE_COUNT - DELETABLE_IDS.length,
        'vec0 count should decrease by 100',
        ReasonCode.VEC_DELETE_FAILED,
      );

      // 用多个查询向量验证：删除的 ID 不应再出现在 Top-10
      // 查询向量靠近 1050（已删除）
      const queryVec = build768Vector(1050);
      const rows = db
        .prepare('SELECT rowid, distance FROM spike_vec WHERE embedding MATCH ? ORDER BY distance LIMIT 10')
        .all(queryVec);
      for (const r of rows) {
        const id = Number(r.rowid);
        harness.assert(
          id < 1000 || id > 1099,
          `vec0 deleted id=${id} must NOT reappear in Top-K`,
          ReasonCode.VEC_DELETE_FAILED,
        );
      }
    });

    // ===== Test 14: vec0 100% 清空 =====
    await runTraced('vec-clear-all', () => {
      db.exec('DELETE FROM spike_vec');
      const cnt = db.prepare('SELECT COUNT(*) AS c FROM spike_vec').get();
      harness.equal(
        Number(cnt.c),
        0,
        'vec0 should be 100% empty after DELETE',
        ReasonCode.VEC_DELETE_FAILED,
      );

      // 查询应返回 0 行
      const rows = db
        .prepare('SELECT rowid, distance FROM spike_vec WHERE embedding MATCH ? ORDER BY distance LIMIT 10')
        .all(build768Vector(1));
      harness.equal(rows.length, 0, 'vec0 query on empty table should return 0 rows', ReasonCode.VEC_DELETE_FAILED);
    });

    // ===== Test 15: vec0 重建（DROP + CREATE + INSERT） =====
    await runTraced('vec-rebuild', () => {
      db.exec('DROP TABLE spike_vec');
      db.exec(`
        CREATE VIRTUAL TABLE spike_vec USING vec0(
          embedding float[${VECTOR_DIM}]
        );
      `);
      // 重新插入前 1000 条（不全部插入，避免重复 10k 开销）
      const subset = fixture.slice(0, 1000);
      const ins = db.prepare('INSERT INTO spike_vec(rowid, embedding) VALUES (?, ?)');
      const tx = db.transaction((items) => {
        for (const item of items) ins.run(BigInt(item.id), item.vector);
      });
      tx(subset);

      const cnt = db.prepare('SELECT COUNT(*) AS c FROM spike_vec').get();
      harness.equal(Number(cnt.c), 1000, 'vec0 rebuild should have 1000 rows', ReasonCode.VEC_LOAD_FAILED);

      // 重建后查询正常
      const rows = db
        .prepare('SELECT rowid, distance FROM spike_vec WHERE embedding MATCH ? ORDER BY distance LIMIT 5')
        .all(build768Vector(1));
      harness.equal(rows.length, 5, 'vec0 rebuild query should return 5 rows', ReasonCode.VEC_LOAD_FAILED);
      harness.equal(Number(rows[0].rowid), 1, 'vec0 rebuild Top-1 should be id=1');
    });

    // ===== Test 16: Exact Oracle 一致性比较 =====
    await runTraced('exact-oracle-consistency', () => {
      // 用 5 个查询向量验证一致性
      const queryIds = [42, 123, 456, 789, 2024];
      let allConsistent = true;
      const allDetails = [];

      for (const qid of queryIds) {
        const queryVec = build768Vector(qid);

        // sqlite-vec Top-10
        const vecResult = db
          .prepare('SELECT rowid, distance FROM spike_vec WHERE embedding MATCH ? ORDER BY distance LIMIT 10')
          .all(queryVec);

        // Oracle Top-10（只对 vec0 中存在的 1000 条计算）
        // 注意：vec0 重建后只有前 1000 条
        const oracleFixture = fixture.slice(0, 1000).map((item) => ({
          id: item.id,
          vector: item.vector,
        }));
        const oracleResult = exactTopK(oracleFixture, queryVec, 10);

        const cmp = compareTopK(vecResult, oracleResult);
        allDetails.push({
          queryId: qid,
          consistent: cmp.consistent,
          mismatchCount: cmp.mismatches.length,
          top1Vec: vecResult[0] ? { rowid: Number(vecResult[0].rowid), distance: vecResult[0].distance } : null,
          top1Oracle: oracleResult[0] ? { rowid: oracleResult[0].rowid, distance: oracleResult[0].distance } : null,
          mismatches: cmp.mismatches.slice(0, 3),
        });
        if (!cmp.consistent) allConsistent = false;
      }

      harness.environment.exactOracle = {
        queryIds,
        results: allDetails,
        tiePolicy: 'rowid ascending when distance delta < 1e-9',
        // vec0 SIMD 与 JS 标量 L2 累加顺序不同，distance 误差通常 < 1e-4。
        // 1e-3 容差覆盖浮点抖动，仍能反证 Top-K 一致性。
        distanceTolerance: 1e-3,
      };

      harness.assert(
        allConsistent,
        `Exact Oracle mismatch: ${JSON.stringify(allDetails.filter((d) => !d.consistent), null, 2)}`,
        ReasonCode.VEC_LOAD_FAILED,
      );
    });

    // ===== 性能门 =====

    // ===== Test 17: FTS5 Top-20 × 100 查询 p95 =====
    await runTraced('fts-perf-p95', () => {
      // 重新插入完整 10k FTS（前面删除了 100 条，补回来保证性能测试数据量）
      // 实际上 FTS5 在 Test 7 删除了 1000-1099，Test 8 rebuild/optimize 后仍少 100 条
      // 为了性能门准确性，用现有数据量测试即可（9900 条仍然够测 p95）

      const queries = ['品牌', 'visual', '设计', 'design', 'motion', '色彩', 'color', '字体', 'typography', 'token'];
      const samples = [];
      for (let i = 0; i < PERF_QUERIES; i++) {
        const q = queries[i % queries.length];
        const start = performance.now();
        db.prepare('SELECT doc_id FROM spike_fts WHERE spike_fts MATCH ? ORDER BY rank LIMIT 20').all(q);
        samples.push(performance.now() - start);
      }
      samples.sort((a, b) => a - b);
      const stats = percentiles(samples);

      harness.environment.ftsPerf = {
        queries: PERF_QUERIES,
        topK: 20,
        p50Ms: stats.p50,
        p95Ms: stats.p95,
        minMs: stats.min,
        maxMs: stats.max,
        guardrailP95Ms: FTS_GUARDRAIL_P95_MS,
        guardrailMet: stats.p95 <= FTS_GUARDRAIL_P95_MS,
      };

      harness.assert(
        stats.p95 <= FTS_GUARDRAIL_P95_MS,
        `FTS5 p95 should be <= ${FTS_GUARDRAIL_P95_MS}ms, got ${stats.p95.toFixed(2)}ms`,
        ReasonCode.GUARDRAIL_PERF,
      );
    });

    // ===== Test 18: vec0 Top-10 × 100 查询 p95 =====
    await runTraced('vec-perf-p95', () => {
      // vec0 重建后只有 1000 条，但性能门要求 10k 数据量
      // 重新插入完整 10k
      db.exec('DELETE FROM spike_vec');
      const ins = db.prepare('INSERT INTO spike_vec(rowid, embedding) VALUES (?, ?)');
      const tx = db.transaction((items) => {
        for (const item of items) ins.run(BigInt(item.id), item.vector);
      });
      tx(fixture);

      const cnt = db.prepare('SELECT COUNT(*) AS c FROM spike_vec').get();
      harness.equal(Number(cnt.c), FIXTURE_COUNT, 'vec0 should have 10k rows for perf test');

      const samples = [];
      for (let i = 0; i < PERF_QUERIES; i++) {
        const qid = (i % 1000) + 1;
        const queryVec = build768Vector(qid);
        const start = performance.now();
        db.prepare('SELECT rowid, distance FROM spike_vec WHERE embedding MATCH ? ORDER BY distance LIMIT 10').all(queryVec);
        samples.push(performance.now() - start);
      }
      samples.sort((a, b) => a - b);
      const stats = percentiles(samples);

      harness.environment.vecPerf = {
        queries: PERF_QUERIES,
        topK: 10,
        rowCount: FIXTURE_COUNT,
        p50Ms: stats.p50,
        p95Ms: stats.p95,
        minMs: stats.min,
        maxMs: stats.max,
        guardrailP95Ms: VEC_GUARDRAIL_P95_MS,
        guardrailMet: stats.p95 <= VEC_GUARDRAIL_P95_MS,
      };

      harness.assert(
        stats.p95 <= VEC_GUARDRAIL_P95_MS,
        `vec0 p95 should be <= ${VEC_GUARDRAIL_P95_MS}ms, got ${stats.p95.toFixed(2)}ms`,
        ReasonCode.GUARDRAIL_PERF,
      );
    });

    // ===== Test 19: 体积报告（DB / WAL / 扩展） =====
    await runTraced('artifact-sizes', () => {
      // checkpoint WAL，让数据落到主 DB
      db.pragma('wal_checkpoint(TRUNCATE)');
      db.close();

      const dbSize = existsSync(dbPath) ? statSync(dbPath).size : 0;
      const walPath = `${dbPath}-wal`;
      const shmPath = `${dbPath}-shm`;
      const walSize = existsSync(walPath) ? statSync(walPath).size : 0;
      const shmSize = existsSync(shmPath) ? statSync(shmPath).size : 0;
      const vecExtPath = resolveVecLoadablePath();
      const vecExtSize = existsSync(vecExtPath) ? statSync(vecExtPath).size : 0;
      const driverNativePath = require.resolve('better-sqlite3-multiple-ciphers/build/Release/better_sqlite3.node');
      const driverNativeSize = existsSync(driverNativePath) ? statSync(driverNativePath).size : 0;

      harness.environment.artifactSizes = {
        dbFileBytes: dbSize,
        walFileBytes: walSize,
        shmFileBytes: shmSize,
        vecExtensionBytes: vecExtSize,
        driverNativeBytes: driverNativeSize,
        dbFileMB: (dbSize / 1024 / 1024).toFixed(2),
        vecExtensionMB: (vecExtSize / 1024 / 1024).toFixed(2),
        driverNativeMB: (driverNativeSize / 1024 / 1024).toFixed(2),
      };

      harness.assert(dbSize > 0, 'DB file should be non-empty after 10k FTS+vec0');
      harness.assert(vecExtSize > 0, 'vec0 extension should be non-empty');
      harness.assert(driverNativeSize > 0, 'driver native module should be non-empty');
    });

    const result = harness.finish();
    Harness.printSummary(result);
    process.exitCode = result.exitCode;
  } catch (e) {
    console.error('FATAL: error in 02-c main:', e);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('FATAL: uncaught error in 02-c:', err);
  process.exitCode = 1;
}).finally(() => {
  if (fixtureDir) cleanupFixtureDir(fixtureDir);
});

process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason);
  process.exit(13);
});
