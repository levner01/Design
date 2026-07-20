/**
 * M0-02 02-B：Spike Schema 与 Migration
 *
 * 仅使用 spike_* 命名空间，不引入任何业务实体。
 * Migration 严格 transactional：每个 version 在单个事务中完成
 *   BEGIN → DDL → INSERT spike_migrations → UPDATE spike_meta.schema_version → COMMIT
 * 强杀后事务自动 rollback，不会留下半状态。
 */

/**
 * v0：初始 schema。新建库时立即创建 spike_meta 与 spike_migrations。
 * spike_meta.schema_version 初始为 0。
 */
export const V0_SCHEMA = `
CREATE TABLE IF NOT EXISTS spike_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS spike_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL,
  description TEXT NOT NULL
);
INSERT OR IGNORE INTO spike_meta (key, value) VALUES ('schema_version', '0');
`;

/**
 * Migration 列表（v1, v2）。
 * 每个 migration 必须是事务安全的：DDL + 数据变更 + 元数据更新放在同一事务。
 */
export const MIGRATIONS = [
  {
    version: 1,
    description: 'add spike_documents table',
    up: (db) => {
      db.exec(`
        CREATE TABLE spike_documents (
          id INTEGER PRIMARY KEY,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 2,
    description: 'add index on spike_documents.created_at + spike_canary table',
    up: (db) => {
      db.exec(`
        CREATE INDEX idx_spike_documents_created ON spike_documents(created_at);
        CREATE TABLE spike_canary (
          id INTEGER PRIMARY KEY,
          secret TEXT NOT NULL
        );
      `);
    },
  },
];

/**
 * 获取当前 schema_version（从 spike_meta）。
 * @param {import('better-sqlite3-multiple-ciphers').Database} db
 * @returns {number}
 */
export function getSchemaVersion(db) {
  const row = db.prepare("SELECT value FROM spike_meta WHERE key = 'schema_version'").get();
  return Number(row?.value ?? 0);
}

/**
 * 设置 schema_version（在事务内调用）。
 */
export function setSchemaVersion(db, version) {
  db.prepare("UPDATE spike_meta SET value = ? WHERE key = 'schema_version'").run(String(version));
}

/**
 * 应用 migrations 直到 targetVersion（含）。
 * 每个 migration 在单个事务中执行，失败回滚。
 * @param {import('better-sqlite3-multiple-ciphers').Database} db
 * @param {number} targetVersion
 * @param {object} [options]
 * @param {boolean} [options.beforeCommit] - 内部钩子：在 COMMIT 之前调用（用于 crash 测试中挂起）
 */
export function migrate(db, targetVersion, options = {}) {
  const current = getSchemaVersion(db);
  if (current > targetVersion) {
    throw new Error(`Cannot migrate down: current=${current} > target=${targetVersion}`);
  }
  for (let v = current + 1; v <= targetVersion; v++) {
    const migration = MIGRATIONS.find((m) => m.version === v);
    if (!migration) {
      throw new Error(`Migration v${v} not found`);
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      migration.up(db);
      db.prepare(
        'INSERT INTO spike_migrations (version, applied_at, description) VALUES (?, ?, ?)',
      ).run(v, new Date().toISOString(), migration.description);
      setSchemaVersion(db, v);
      if (options.beforeCommit) {
        options.beforeCommit(db, v);
      }
      db.exec('COMMIT');
    } catch (e) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // ignore rollback errors
      }
      throw e;
    }
  }
}

/**
 * 初始化 v0 schema。仅在新建库时调用。
 * @param {import('better-sqlite3-multiple-ciphers').Database} db
 */
export function initSchema(db) {
  db.exec(V0_SCHEMA);
}

/**
 * 验证 spike_migrations 表中的记录与预期一致。
 * @param {import('better-sqlite3-multiple-ciphers').Database} db
 * @param {number} expectedVersion
 */
export function assertMigrationsApplied(db, expectedVersion) {
  const rows = db.prepare('SELECT version FROM spike_migrations ORDER BY version').all();
  const versions = rows.map((r) => r.version);
  const expected = [];
  for (let v = 1; v <= expectedVersion; v++) expected.push(v);
  if (JSON.stringify(versions) !== JSON.stringify(expected)) {
    throw new Error(
      `spike_migrations mismatch: actual=${JSON.stringify(versions)}, expected=${JSON.stringify(expected)}`,
    );
  }
}
