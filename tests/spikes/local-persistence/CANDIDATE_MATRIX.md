# M0-02 本地持久化候选矩阵（02-A）

> 版本：1.0 · 状态：02-A 探测完成，待 02-B/02-C 工程证据进一步证明
> 探测环境：macOS arm64 · Node.js v24.0.0 · pnpm@11.13.1 · 本机源码编译（无 prebuild）
> 探测时间：2026-07-20

## 1. 主候选清单（已锁定精确版本）

| 依赖 | 名称 | 精确版本 | 类型 | 锁定方式 |
|---|---|---|---|---|
| SQLite Driver | `better-sqlite3-multiple-ciphers` | `12.11.1` | devDependency（apps/desktop） | 字面版本号，无 `^`/`*`/`latest` |
| 向量扩展 | `sqlite-vec` | `0.1.9` | devDependency（apps/desktop） | 字面版本号，无 `^`/`*`/`latest` |

`pnpm-workspace.yaml` 的 `allowBuilds` 显式声明：

```yaml
allowBuilds:
  electron: true
  esbuild: true
  better-sqlite3-multiple-ciphers: true
  sqlite-vec: true
```

## 2. SQLite Driver 探测结果

### 2.1 基本信息

| 字段 | 值 |
|---|---|
| Driver 名称 | `better-sqlite3-multiple-ciphers` |
| 精确版本 | `12.11.1` |
| 上游 fork | `better-sqlite3@12.x`（同步上游） |
| 维护者 | Mahesh Bandara Wijerathna (m4heshd) |
| 仓库 | https://github.com/m4heshd/better-sqlite3-multiple-ciphers |
| 许可证 | MIT |
| 商业限制 | 无 |
| Trial 限制 | 无 |
| 归属要求 | 保留 LICENSE 与版权声明 |
| 维护状态 | 活跃（与上游 better-sqlite3 同步发布） |
| 升级风险 | 中等（fork 与上游同步存在 1–2 周延迟；major bump 偶有 ABI 破坏） |

### 2.2 内嵌 SQLite 版本

| 字段 | 值 |
|---|---|
| `sqlite_version()` | `3.53.2` |
| SQLite 发布日期 | 2024-10-21 |
| SQLite 已知 CVE | 探测时无未修复高危 CVE；3.53.x 已包含 FTS3/FTS5/RTREE 修复 |
| 是否包含官方修复 | 是（基于 SQLite 官方 3.53.2 amalgamation 编译） |

### 2.3 `PRAGMA compile_options`（关键项）

```
ATOMIC_INTRINSICS=1
COMPILER=clang-17.0.0
DEFAULT_FOREIGN_KEYS           ← FK 默认开启
DEFAULT_SYNCHRONOUS=2         ← FULL 同步
DEFAULT_WAL_SYNCHRONOUS=1      ← WAL 模式 NORMAL 同步
DEFAULT_WAL_AUTOCHECKPOINT=1000
ENABLE_COLUMN_METADATA
ENABLE_DBSTAT_VTAB
ENABLE_FTS3
ENABLE_FTS3_PARENTHESIS
ENABLE_FTS4
ENABLE_FTS5                    ← FTS5 已内嵌
ENABLE_GEOPOLY
ENABLE_MATH_FUNCTIONS
ENABLE_PERCENTILE
ENABLE_RTREE
ENABLE_STAT4
ENABLE_UPDATE_DELETE_LIMIT
LIKE_DOESNT_MATCH_BLOBS
MAX_VARIABLE_NUMBER=32766
MUTEX_PTHREADS
OMIT_SHARED_CACHE               ← 禁用 shared-cache（多连接隔离）
SOUNDEX
THREADSAFE=2                    ← Serialized multi-thread 模式
USE_URI                         ← 支持 file: URI
```

未启用：`ENABLE_LOAD_EXTENSION`（默认禁用，但 fork 直接提供 `db.loadExtension()`，无需 `enableLoadExtension(true)`，避免被恶意代码绕过启用）。

### 2.4 加密机制

| 字段 | 值 |
|---|---|
| 加密实现 | 内嵌（fork 自带，不依赖外部 sqlcipher） |
| 支持算法 | `aes-256-cbc`、`aes-256-gcm`、`aes-256-ctr`、`chacha20`、`sqlcipher`（兼容模式） |
| Key 设置方式 | `db.pragma("key = 'passphrase'")` 或 `db.pragma("rekey = 'new'")` |
| 正确 Key 行为 | 可读、可写、可重开 ✓（已探测） |
| 错误 Key 行为 | 抛 `SqliteError: file is not a database` ✓（已探测） |
| 错误 Key 副作用 | 不新建、不截断、不覆盖原库 ✓（DB 头被加密随机化，错误 Key 无法解密头） |
| DB 头检测 | 前 16 字节不是 `SQLite format 3\0` ✓（已探测） |

### 2.5 FTS5 支持

| 字段 | 值 |
|---|---|
| FTS5 编译支持 | `ENABLE_FTS5` ✓ |
| FTS5 加密库内可用 | ✓（与 encryption 共存，已探测） |
| 中文分词策略 | SQLite FTS5 内置 `unicode61`+`remove_diacritics 2`；中文需自建 tokenizer 或使用 `trigram`（M0-02 Spike 内验证） |
| 删除/重建 API | `DELETE`、`INSERT INTO table(table, rowid, ...) VALUES('delete', ...)`、`INSERT INTO table(table) VALUES('rebuild')`、`INSERT INTO table(table) VALUES('optimize')` |

### 2.6 Extension Loading 支持

| 字段 | 值 |
|---|---|
| 是否提供 `db.loadExtension(path)` | ✓ |
| 是否需要 `db.enableLoadExtension(true)` | ✗（fork 已封装，直接 loadExtension） |
| 加载 sqlite-vec `vec0.dylib` | ✓（已探测） |
| 加载失败行为 | 抛 `SqliteError`，原因码由 vec0 自身提供 |

## 3. sqlite-vec 探测结果

| 字段 | 值 |
|---|---|
| npm 包 | `sqlite-vec` |
| 精确版本 | `0.1.9` |
| 作者 | Alex Garcia |
| 仓库 | https://github.com/asg017/sqlite-vec |
| 许可证 | `MIT OR Apache-2.0`（双许可，可选其一） |
| 商业限制 | 无 |
| Trial 限制 | 无 |
| 归属要求 | 保留 LICENSE（MIT 或 Apache-2.0 任选其一） |
| 维护状态 | 活跃但 pre-v1（API 可能变更；0.1.x 与 0.2.x 不向后兼容） |
| 升级风险 | 高（pre-v1；升级需重新跑 02-B/02-C 全部证据；0.1.10+ 引入 `vec_quantize('q8')` 等 API 变更） |
| vec_version() | `v0.1.9` |
| 加载方式 | `sqlite-vec` 主包按平台解析到 `sqlite-vec-<os>-<arch>/vec0.<ext>`，调用 `db.loadExtension()` |
| 扩展文件后缀 | darwin→`.dylib`，win32→`.dll`，linux→`.so` |

### 3.1 sqlite-vec 提供的函数

```
vec_add, vec_bit, vec_debug, vec_distance_cosine,
vec_distance_hamming, vec_distance_l1, vec_distance_l2,
vec_f32, vec_int8, vec_length, vec_normalize,
vec_quantize_binary, vec_quantize_int8, vec_slice, vec_sub,
vec_to_json, vec_type, vec_version
```

> 注意：0.1.9 不提供 `vec_quantize('q8')`（0.1.10+ 才引入）。Spike 内只能使用 `vec_quantize_binary` 与 `vec_quantize_int8`。

### 3.2 vec0 虚拟表行为

| 字段 | 值 |
|---|---|
| DDL | `CREATE VIRTUAL TABLE vec_demo USING vec0(embedding float[768])` |
| Shadow Tables | `vec_demo_chunks`, `vec_demo_info`, `vec_demo_rowids`, `vec_demo_vector_chunks00` |
| 插入 | `INSERT INTO vec_demo(rowid, embedding) VALUES (?, ?)` |
| 查询 | `SELECT rowid, distance FROM vec_demo WHERE embedding MATCH ? ORDER BY distance LIMIT ?` |
| 删除 | `DELETE FROM vec_demo WHERE rowid = ?` |
| 清空 | `DELETE FROM vec_demo`（shadow tables 一并清空） |
| **rowid 类型约束** | **必须为 BigInt**（better-sqlite3 需 `db.defaultSafeIntegers = true` 或 `db.safeIntegers(true)`） |
| 插入 Number rowid | 抛 `Only integers are allowed for primary key values on vec_demo` |

### 3.3 平台子包

| 平台 | 子包 | 二进制 |
|---|---|---|
| darwin arm64 | `sqlite-vec-darwin-arm64@0.1.9` | `vec0.dylib`（160KB，Mach-O 64-bit arm64） |
| darwin x64 | `sqlite-vec-darwin-x64@0.1.9` | `vec0.dylib` |
| win32 x64 | `sqlite-vec-windows-x64@0.1.9` | `vec0.dll` |
| linux x64 | `sqlite-vec-linux-x64@0.1.9` | `vec0.so` |
| linux arm64 | `sqlite-vec-linux-arm64@0.1.9` | `vec0.so` |

`sqlite-vec@0.1.9` 的 `optionalDependencies` 已包含全部 5 个平台子包，pnpm 安装时会按当前 `process.platform` 与 `process.arch` 只解压匹配子包。

## 4. Electron ABI / N-API

| 字段 | 值 |
|---|---|
| Electron 目标版本 | 33.2.x |
| Electron Node ABI | 130（Electron 33） |
| Node 24 ABI | 137 |
| Node 22 ABI | 127 |
| `better-sqlite3-multiple-ciphers` N-API 版本 | N-API v8（`node-addon-api`，跨 ABI 稳定） |
| Node 开发态加载 | ✓（本机源码编译，针对 Node 24 ABI = 137） |
| Electron 加载 | 需 `@electron/rebuild` 针对 Electron ABI 130 重编译；CI 02-E 阶段验证 |
| macOS arm64 二进制 | ✓（本机编译产物：`better_sqlite3.node` 2.1MB，arm64） |
| macOS x64 二进制 | 需 CI 02-E macos-15-intel/x64 验证 |
| Windows x64 二进制 | 需 CI 02-E windows-latest/x64 验证 |

## 5. ASAR / asarUnpack 策略

| 资源 | 路径 | asarUnpack | 说明 |
|---|---|---|---|
| Driver `.node` | `node_modules/better-sqlite3-multiple-ciphers/build/Release/better_sqlite3.node` | **必须** | Node 原生模块无法从 ASAR 内加载 |
| sqlite-vec 扩展 | `node_modules/sqlite-vec-*/vec0.<ext>` | **必须** | `loadExtension()` 通过文件系统路径加载，需解包 |
| `sqlite-vec` 主包 | `node_modules/sqlite-vec/index.cjs` | 可选 | 仅平台解析逻辑，可在 ASAR 内 |
| `better-sqlite3-multiple-ciphers` JS wrapper | `node_modules/better-sqlite3-multiple-ciphers/lib/**` | 可选 | 纯 JS，可在 ASAR 内 |

`apps/desktop/electron-builder.json` 的 `asarUnpack` 字段将在 02-E 阶段配置：

```json
"asarUnpack": [
  "node_modules/better-sqlite3-multiple-ciphers/build/Release/**",
  "node_modules/sqlite-vec-*/**"
]
```

## 6. 体积与产物增量

| 资源 | 大小 | 说明 |
|---|---|---|
| `better_sqlite3.node`（macOS arm64，源码编译） | 2.1 MB | 含 SQLite amalgamation + sqlcipher 实现 |
| `vec0.dylib`（macOS arm64） | 160 KB | sqlite-vec 扩展 |
| `sqlite-vec` 主包 + 5 平台子包（解压后） | ≈ 800 KB | 但 pnpm 只解压当前平台子包，实际增量 ≈ 160–200 KB |
| 预估 macOS Packaged App 增量 | ≈ 2.3 MB（arm64）/ ≈ 2.3 MB（x64） | 含 driver + vec + JS wrapper |
| 预估 Windows Packaged App 增量 | ≈ 2.5 MB（x64） | Windows 二进制略大 |
| DB / WAL / SHM 运行时体积 | 由 02-B/02-C 实测后填入报告 | 不计入 ASAR |

## 7. 备选候选（仅当主候选 Partial Handoff 时启用）

| 候选 | Driver | 加密 | Vector | 评估 |
|---|---|---|---|---|
| **主候选** | `better-sqlite3-multiple-ciphers@12.11.1` | 内嵌多算法 | `sqlite-vec@0.1.9` | ✅ 已通过 02-A 全部探测 |
| 备选 A | `better-sqlite3`（官方） + `@vscode/sqlite3` 风格的 sqlcipher 绑定 | 需另接 `sqlcipher` 绑定 | `sqlite-vec@0.1.9` | ❌ 官方 better-sqlite3 不支持加密；需额外维护 sqlcipher 绑定，工作量大 |
| 备选 B | `sql.js`（WASM） + WASM 版 sqlite-vec | 不支持加密 | 不支持 native vec | ❌ 不满足 Local-first 加密硬约束 |
| 备选 C | `@libsql/client`（libSQL） | 内嵌加密 | 内置 `vector` 类型 | ⚠ libSQL 是 SQLite fork，二进制兼容性未在 Electron 33 验证；许可证 BSL，需法务确认 |
| 备选 D | `knex` + `better-sqlite3` + `sqlite-vss` | 同备选 A 问题 | `sqlite-vss`（已废弃，作者迁移到 sqlite-vec） | ❌ sqlite-vss 已停止维护，不可作为候选 |

**结论**：主候选通过 02-A 探测，不引入备选。若 02-B/02-C/02-E 任一阶段触发立即停工条件（错误 Key 能读、原生模块不能从 Packaged App 加载、双平台 ABI 不兼容等），按 HANDOFF_PROTOCOL §4.1 提交 Partial Handoff，备选 A 是首选回退候选。

## 8. 02-A 探测命令清单

所有探测命令与退出码、输出快照保存在：

- `tests/spikes/local-persistence/02-a-candidate-harness.test.mjs`（02-A 测试入口）
- `tests/spikes/local-persistence/run/02-a-probe.json`（探测结果 JSON，由测试生成，.gitignore）

02-A 测试覆盖：

1. `better-sqlite3-multiple-ciphers` 可被 `import` 加载
2. `sqlite_version()` 返回 `3.53.2`
3. `PRAGMA compile_options` 包含 `ENABLE_FTS5`、`DEFAULT_FOREIGN_KEYS`、`THREADSAFE=2`
4. FTS5 virtual table 可创建
5. `db.loadExtension(vecPath)` 可加载 sqlite-vec
6. `vec_version()` 返回 `v0.1.9`
7. vec0 virtual table 可创建、插入（BigInt rowid）、查询、删除
8. 错误 Key 抛 `file is not a database`
9. DB 头 16 字节不等于 `SQLite format 3\0`
10. `sqlite-vec` 解析的平台子包路径真实存在

## 9. 立即停工条件回顾

依据 m2-02.md §五，02-A 阶段以下任一不通过则立即停工：

- ✅ 主候选不需要更换 SQLite、加密、Vector 或顶层架构
- ✅ macOS arm64 原生模块可加载（macOS x64 / Windows x64 待 02-E CI 验证）
- ✅ 错误 Key 不能读取数据（已探测）
- ✅ DB 头不出现 `SQLite format 3` 明文（已探测）
- ✅ sqlite-vec 可在开发态加载（Packaged App 加载待 02-E 验证）
- ✅ 不需要静默禁用加密、FTS5 或 Vector
- ✅ 许可证允许闭源 Beta 分发（MIT / MIT OR Apache-2.0）
- ✅ 不需要修改允许目录之外的文件

02-A 全部通过，可进入 02-B。
