/**
 * M0-02 02-E：Packaged App Spike Runner（双开关限制）
 *
 * 在 Electron Packaged App 的 Main 进程中真实执行核心 Spike 验证，
 * 通过安全 Sentinel 返回结构化 JSON 结果。
 *
 * 双开关限制（m2-02.md §四 02-E）：
 *   - DESIGNWAN_SPIKE_MODE === '1' 且
 *   - DESIGNWAN_SPIKE_SENTINEL 指向合法路径
 *   生产普通启动（SPIKE_MODE !== '1'）完全不执行 Spike，不写 sentinel，
 *   也不暴露给 Renderer/Preload（不注册 IPC handler）。
 *
 * 路径安全（与 smoke sentinel 同策略）：
 *   - 路径规范化后不得包含 `..`
 *   - 父目录 realpath 必须位于 <tmpdir>/designwan-spike-* 专用临时目录
 *   - 禁止符号链接逃逸、任意绝对路径、覆盖已有非 Sentinel 文件
 *
 * 核心验证（最小集，<500ms）：
 *   1. driver load（better-sqlite3-multiple-ciphers）
 *   2. sqlite_version() = 3.53.2
 *   3. compile_options 含 ENABLE_FTS5
 *   4. encryption create + reopen（正确 key）
 *   5. wrong key rejected（抛 'file is not a database'）
 *   6. vec load + vec_version() = v0.1.9
 *   7. FTS5 lifecycle（trigram create + insert + MATCH + delete + zero hit）
 *   8. vec0 lifecycle（insert + Top-K + delete + not return）
 *
 * 不跑 10k 性能门（packaged app 跑性能门太慢，CI 已在 verify:local-data --spike 跑过）。
 */
import { app } from 'electron';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  realpathSync,
  lstatSync,
  writeFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * 解析 sqlite-vec 原生扩展路径。
 *
 * Packaged App：build.mjs 已把当前平台的 vec0.<ext> 复制到 dist/main/spike-vec/，
 * electron-builder 通过 asarUnpack "dist/main/spike-vec/**" 把它解包到
 * app.asar.unpacked/dist/main/spike-vec/。
 *
 * 关键约束：db.loadExtension(path) 走 SQLite C API 的 dlopen，不经过 Electron 的
 * require 机制，不会自动把 app.asar/ 重定向到 app.asar.unpacked/。Electron 的
 * existsSync 对 asar 路径返回 true（重定向），但 dlopen 不认识 asar 内的 .dylib
 * （errno=20 ENOTDIR），SQLite fallback 追加 .dylib 后缀变成 vec0.dylib.dylib 也失败。
 *
 * 因此必须显式构造 app.asar.unpacked/ 实际路径传给 loadExtension。
 *
 * Dev：直接用 sqlite-vec 包的 getLoadablePath() 解析平台子包路径。
 */
function resolveVecLoadablePath(): string {
  const ext = process.platform === 'win32' ? 'dll' : process.platform === 'darwin' ? 'dylib' : 'so';

  // Packaged App：import.meta.dirname 在 app.asar/dist/main/ 下，
  // 用 process.resourcesPath 定位到 app.asar.unpacked/dist/main/spike-vec/
  if (process.resourcesPath && import.meta.dirname.includes('app.asar')) {
    const unpackedPath = path.join(
      process.resourcesPath,
      'app.asar.unpacked',
      'dist',
      'main',
      'spike-vec',
      `vec0.${ext}`,
    );
    if (existsSync(unpackedPath)) {
      return unpackedPath;
    }
  }

  // Dev fallback：用 sqlite-vec 包的 getLoadablePath()
  const { getLoadablePath } = require('sqlite-vec');
  return getLoadablePath();
}

interface SpikeCheck {
  name: string;
  ok: boolean;
  durationMs: number;
  error?: string;
}

interface SpikeResult {
  ok: boolean;
  checks: SpikeCheck[];
  environment: {
    runtime: 'electron';
    electronVersion: string;
    nodeVersion: string;
    platform: string;
    arch: string;
    sqlite: { version: string; fts5: boolean };
    vec: { version: string; loadablePath: string };
    driverNativePath: string;
  };
  timestamp: string;
  durationMs: number;
}

/**
 * 校验并返回安全的 Spike Sentinel 路径。
 * 生产启动（SPIKE_MODE 未开启）返回 null，完全不执行 Spike。
 */
function resolveSpikeSentinelPath(): string | null {
  if (process.env.DESIGNWAN_SPIKE_MODE !== '1') return null;
  const raw = process.env.DESIGNWAN_SPIKE_SENTINEL;
  if (!raw) return null;

  // 规范化：resolve 后路径段不得为 `..`
  const resolved = path.resolve(raw);
  const segments = resolved.split(path.sep);
  if (segments.includes('..')) {
    console.error(`[spike] sentinel path contains '..': ${raw}`);
    return null;
  }

  // sentinel 路径本身不得是 symlink（防假绿）
  try {
    const stat = lstatSync(resolved);
    if (stat.isSymbolicLink()) {
      console.error(
        `[spike][SENTINEL_SYMLINK_REJECTED] sentinel path must not be a symlink: ${raw}`,
      );
      return null;
    }
  } catch (e) {
    const errno = (e as NodeJS.ErrnoException).code;
    if (errno !== 'ENOENT') {
      console.error(`[spike] sentinel path lstat failed: ${(e as Error).message}`);
      return null;
    }
    // ENOENT：文件不存在，正常（App 会用 wx flag 创建）
  }

  // 父目录 realpath 必须位于 <tmpdir>/designwan-spike-* 专用临时目录
  const parent = path.dirname(resolved);
  let realTmpdir: string;
  try {
    realTmpdir = realpathSync(os.tmpdir());
  } catch (e) {
    console.error(`[spike] tmpdir not accessible: ${os.tmpdir()} (${(e as Error).message})`);
    return null;
  }
  const expectedPrefix = path.join(realTmpdir, 'designwan-spike-');
  let realParent: string;
  try {
    realParent = realpathSync(parent);
  } catch (e) {
    console.error(
      `[spike] sentinel parent dir not accessible: ${parent} (${(e as Error).message})`,
    );
    return null;
  }
  if (!realParent.startsWith(expectedPrefix)) {
    console.error(`[spike] sentinel parent must be under ${expectedPrefix}*, got ${realParent}`);
    return null;
  }

  // 文件名必须是 .json 后缀
  if (!resolved.endsWith('.json')) {
    console.error(`[spike] sentinel path must end with .json: ${raw}`);
    return null;
  }

  return resolved;
}

/**
 * 计时包装：跑单个 check 并记录耗时与异常。
 */
function runCheck(name: string, fn: () => void): SpikeCheck {
  const start = Date.now();
  try {
    fn();
    return { name, ok: true, durationMs: Date.now() - start };
  } catch (e) {
    return { name, ok: false, durationMs: Date.now() - start, error: String((e as Error).message) };
  }
}

/**
 * 执行核心 Spike 验证（最小集）。
 * 临时 DB 文件创建在 <tmpdir>/designwan-spike-<random>/ 下，验证后清理。
 */
function runSpikeChecks(): {
  result: Omit<SpikeResult, 'ok' | 'timestamp' | 'durationMs'>;
  tmpDir: string;
} {
  const Database = require('better-sqlite3-multiple-ciphers');

  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'designwan-spike-runner-'));
  const checks: SpikeCheck[] = [];

  // 环境探测（用于 sentinel 报告）
  const probeDb = new Database(':memory:');
  const sqliteVersion = probeDb.prepare('SELECT sqlite_version() AS v').get().v as string;
  const compileOptions = probeDb
    .prepare('PRAGMA compile_options')
    .all()
    .map((r: { compile_options: string }) => r.compile_options);
  const fts5Enabled = compileOptions.includes('ENABLE_FTS5');
  probeDb.close();

  // 1. driver load
  checks.push(
    runCheck('driver-load', () => {
      if (typeof Database !== 'function') throw new Error('Database is not a constructor');
    }),
  );

  // 2. sqlite_version
  checks.push(
    runCheck('sqlite-version', () => {
      const db = new Database(':memory:');
      const v = db.prepare('SELECT sqlite_version() AS v').get().v;
      if (v !== '3.53.2') throw new Error(`sqlite_version expected 3.53.2, got ${v}`);
      db.close();
    }),
  );

  // 3. compile_options 含 ENABLE_FTS5
  checks.push(
    runCheck('compile-options-fts5', () => {
      if (!fts5Enabled) throw new Error('ENABLE_FTS5 missing from compile_options');
    }),
  );

  // 4. encryption create + reopen（正确 key）
  const encDbPath = path.join(tmpDir, 'enc.db');
  checks.push(
    runCheck('encryption-correct-key', () => {
      const db = new Database(encDbPath);
      db.pragma("key = 'spike-test-key'");
      db.exec('CREATE TABLE t (v TEXT)');
      db.prepare('INSERT INTO t VALUES (?)').run('encrypted-data');
      db.close();

      const db2 = new Database(encDbPath);
      db2.pragma("key = 'spike-test-key'");
      const rows = db2.prepare('SELECT * FROM t').all();
      if (rows.length !== 1 || rows[0].v !== 'encrypted-data') {
        throw new Error(`correct key read mismatch: rows=${rows.length}`);
      }
      db2.close();

      // DB header 不应是明文 SQLite format 3
      const buf = readFileSync(encDbPath);
      const header = buf.subarray(0, 16).toString('utf8');
      if (header.includes('SQLite format 3')) {
        throw new Error('DB header leaks SQLite format 3 (encryption disabled)');
      }
    }),
  );

  // 5. wrong key rejected
  checks.push(
    runCheck('wrong-key-rejected', () => {
      let wrongKeyAccepted = false;
      let caughtMsg = '';
      try {
        const db = new Database(encDbPath);
        db.pragma("key = 'wrong-key'");
        db.prepare('SELECT * FROM t').all();
        wrongKeyAccepted = true;
        db.close();
      } catch (e) {
        caughtMsg = String((e as Error).message);
      }
      if (wrongKeyAccepted) throw new Error('wrong key unexpectedly accepted');
      if (!/not a database|file is not/.test(caughtMsg)) {
        throw new Error(`wrong key error mismatch: ${caughtMsg}`);
      }
    }),
  );

  // 6. vec load + version
  const vecLoadablePath = resolveVecLoadablePath();
  checks.push(
    runCheck('vec-load-and-version', () => {
      if (!existsSync(vecLoadablePath))
        throw new Error(`vec0 extension not found: ${vecLoadablePath}`);
      const db = new Database(':memory:');
      db.loadExtension(vecLoadablePath);
      const v = db.prepare('SELECT vec_version() AS v').get().v;
      if (v !== 'v0.1.9') throw new Error(`vec_version expected v0.1.9, got ${v}`);
      db.close();
    }),
  );

  // 7. FTS5 lifecycle（trigram create + insert + MATCH + delete + zero hit）
  const ftsDbPath = path.join(tmpDir, 'fts.db');
  checks.push(
    runCheck('fts5-lifecycle', () => {
      const db = new Database(ftsDbPath);
      db.pragma("key = 'fts-key'");
      db.exec("CREATE VIRTUAL TABLE spike_fts USING fts5(content, tokenize='trigram')");
      db.prepare('INSERT INTO spike_fts VALUES (?)').run('designwan-persistence-spike');
      const before = db
        .prepare("SELECT rowid FROM spike_fts WHERE spike_fts MATCH 'designwan'")
        .all();
      if (before.length !== 1)
        throw new Error(`FTS5 before delete expected 1 row, got ${before.length}`);
      db.prepare('DELETE FROM spike_fts').run();
      const after = db
        .prepare("SELECT rowid FROM spike_fts WHERE spike_fts MATCH 'designwan'")
        .all();
      if (after.length !== 0)
        throw new Error(`FTS5 after delete expected 0 rows, got ${after.length}`);
      db.close();
    }),
  );

  // 8. vec0 lifecycle（insert + Top-K + delete + not return）
  const vecDbPath = path.join(tmpDir, 'vec.db');
  checks.push(
    runCheck('vec0-lifecycle', () => {
      const db = new Database(vecDbPath);
      db.pragma("key = 'vec-key'");
      db.pragma('journal_mode = WAL');
      db.defaultSafeIntegers = true;
      db.loadExtension(vecLoadablePath);
      db.exec('CREATE VIRTUAL TABLE spike_vec USING vec0(embedding float[4])');
      const ins = db.prepare('INSERT INTO spike_vec(rowid, embedding) VALUES (?, ?)');
      ins.run(BigInt(1), new Float32Array([1, 2, 3, 4]));
      ins.run(BigInt(2), new Float32Array([5, 6, 7, 8]));
      ins.run(BigInt(3), new Float32Array([1.5, 2.5, 3.5, 4.5]));
      const top = db
        .prepare(
          'SELECT rowid, distance FROM spike_vec WHERE embedding MATCH ? ORDER BY distance LIMIT 1',
        )
        .all(new Float32Array([1.01, 2.01, 3.01, 4.01]));
      if (top.length !== 1 || Number(top[0].rowid) !== 1) {
        throw new Error(`vec0 Top-1 expected rowid=1, got ${JSON.stringify(top)}`);
      }
      db.prepare('DELETE FROM spike_vec WHERE rowid = ?').run(BigInt(1));
      const afterDelete = db
        .prepare('SELECT rowid FROM spike_vec WHERE embedding MATCH ? ORDER BY distance LIMIT 5')
        .all(new Float32Array([1, 2, 3, 4]));
      if (!afterDelete.every((r: { rowid: bigint }) => Number(r.rowid) !== 1)) {
        throw new Error('vec0 deleted rowid=1 reappeared in Top-K');
      }
      db.close();
    }),
  );

  // 驱动 native 路径（用于报告）
  const driverNativePath =
    require.resolve('better-sqlite3-multiple-ciphers/build/Release/better_sqlite3.node');

  return {
    result: {
      checks,
      environment: {
        runtime: 'electron',
        electronVersion: process.versions.electron,
        nodeVersion: process.versions.node,
        platform: process.platform,
        arch: process.arch,
        sqlite: { version: sqliteVersion, fts5: fts5Enabled },
        vec: { version: 'v0.1.9', loadablePath: vecLoadablePath },
        driverNativePath,
      },
    },
    tmpDir,
  };
}

/**
 * 入口：如果双开关开启，跑 Spike 并写 sentinel。
 * 生产启动（SPIKE_MODE !== '1'）完全不执行，直接返回。
 */
export async function runSpikeIfEnabled(): Promise<void> {
  const sentinelPath = resolveSpikeSentinelPath();
  if (!sentinelPath) return;

  const start = Date.now();
  let tmpDir: string | null = null;
  let result: SpikeResult;

  try {
    const { result: partial, tmpDir: td } = runSpikeChecks();
    tmpDir = td;
    const allOk = partial.checks.every((c) => c.ok);
    result = {
      ok: allOk,
      checks: partial.checks,
      environment: partial.environment,
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - start,
    };
  } catch (e) {
    result = {
      ok: false,
      checks: [],
      environment: {
        runtime: 'electron',
        electronVersion: process.versions.electron,
        nodeVersion: process.versions.node,
        platform: process.platform,
        arch: process.arch,
        sqlite: { version: 'unknown', fts5: false },
        vec: { version: 'unknown', loadablePath: 'unknown' },
        driverNativePath: 'unknown',
      },
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - start,
    };
    console.error(`[spike] FATAL error: ${(e as Error).message}`);
  }

  // 写 sentinel（独占创建，flag 'wx' 在文件已存在时报错）
  try {
    writeFileSync(sentinelPath, JSON.stringify(result, null, 2), { flag: 'wx' });
    console.log(`[spike] sentinel written: ${sentinelPath} ok=${result.ok}`);
  } catch (e) {
    console.error(`[spike] sentinel write failed: ${(e as Error).message}`);
  }

  // 清理临时目录
  if (tmpDir) {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup error
    }
  }

  // 退出码：ok=true → 0，ok=false → 1
  app.exit(result.ok ? 0 : 1);
}
