# DesignWan 本地 SQLite 数据模型

版本：v2.0  
状态：MVP 本地数据开发基线  
规范数据面：用户设备上的 SQLite + FTS5 + Encrypted Asset Vault + LocalVectorIndex  
可选控制面：Supabase Singapore，仅 Auth/License/Billing/Model Catalog/Managed Usage

相关文档：[技术栈与架构](STACK_AND_ARCHITECTURE.md) · [领域模型](DOMAIN_MODEL.md) · [个人记忆](MEMORY_SYSTEM.md) · [知识图谱](KNOWLEDGE_GRAPH.md)

## 1. 数据主权结论

- 本地 SQLite 是素材元数据、Project、Decision、Memory、Graph、FTS5、Job、AI 本地审计和删除状态的唯一规范事实源。
- Asset 文件、预览、导入原件、原始 Prompt/输出、恢复副本和 App-managed Backup 保存在应用管理的加密文件库，不进入云端 Storage。
- LocalVectorIndex 是派生索引；向量内容留在设备。业务事实不能依赖某个 `sqlite-vec` 私有 RowID 才能恢复。
- Supabase 只保留控制面元数据，Singapore `ap-southeast-1` 只属于控制面，不描述业务数据驻留。
- Local 与 BYOK Route 不上传平台计费明细；Managed Route 控制面只保存无内容 Usage，不保存原始 Prompt/Response。
- SQLite 没有 RLS。本地安全依赖 Electron Main 的 IPC/Actor/Project Policy 与 Renderer 隔离，不允许 Renderer 或 Extension 直连数据库。

## 2. 本地目录与存储角色

建议逻辑布局：

```text
app-data/
├─ db/
│  ├─ designwan.sqlite
│  ├─ designwan.sqlite-wal
│  └─ designwan.sqlite-shm
├─ vault/
│  ├─ objects/              # 加密 Asset / Prompt Payload /恢复对象
│  ├─ previews/             # 加密或策略允许的派生预览
│  └─ staging/              # 隔离临时区，成功后原子迁移
├─ vector/                  # LocalVectorIndex Adapter 管理，业务不直接依赖布局
├─ cache/                   # 可删除重建，不保存唯一事实
├─ backups/                 # App-managed 加密备份
└─ state/                   # 非敏感运行状态与锁
```

规则：

- 路径不包含 Client/Project/文件名；使用随机 Object ID。
- SQLite 只保存相对 Object Ref，不保存可被 Renderer 使用的绝对路径。
- Staging、WAL、Temp、Crash 和 Backup 全部纳入敏感明文扫描。
- App-managed 目录之外的 iCloud、Time Machine、OneDrive、OS Snapshot 不属于产品可控删除面。

## 3. SQLite 基础约定

### 3.1 连接与写入

- Electron Main 持有规范写入口；Utility Worker 通过类型化 Command/Result 与 Main 协作，默认不持有长期写连接。
- 启用 Foreign Keys、WAL、Busy Timeout；事务必须短，不在事务内等待模型、网络或大文件加密。
- 应用启动运行 `quick_check`/版本检查；异常时进入只读恢复模式，不“自动修复”到丢数据。
- Migration 只前进，采用 Expand → Backfill → Switch → Contract；每次升级前验证 App-managed Backup。
- UUIDv7 由应用层生成；时间以 UTC ISO-8601 Text 或 Unix Milliseconds 统一，界面再按用户时区显示。

### 3.2 公共列

本地业务表默认包含：

```text
id text primary key
workspace_id text not null
owner_type text not null
owner_id text not null
visibility text not null
project_scope text
client_scope text
created_by text not null
created_at text not null
updated_at text not null
version integer not null
deleted_at text
recoverable_until text
purge_after text
```

`deleted_at` 是 T0 Tombstone；`recoverable_until = T0 + 7d`，`purge_after = T0 + 8d`。T0 后普通查询、FTS5、向量、Graph、Cache、Job 和 AI Context 都必须不可命中。

### 3.3 敏感字段

高敏字段不以明文 Text 保存，使用统一 Envelope：

```text
ciphertext blob
key_ref text
algorithm_version text
nonce_or_header blob
plaintext_digest text
```

`plaintext_digest` 必须是带秘密 Pepper 或其他不可离线枚举的策略；不能把客户原句的裸 SHA-256 当匿名化。具体 Cipher/Key Adapter 由 M0 Spike 冻结。

## 4. 表命名与模块所有权

SQLite 没有 PostgreSQL Schema，使用前缀表达所有权：

| 前缀 | 内容 | 唯一写入 Module |
|---|---|---|
| `identity_` | 本地 Profile、Workspace、设备/授权缓存 | Identity |
| `project_` | Client、Project、需求、判断、证据、Decision、结果 | Projects/Decisions |
| `asset_` | Capture、导入、Source、Asset、File、Fragment、Board | Capture/Assets |
| `memory_` | Candidate、Memory、Evidence、Conflict、Dictionary、UserModel | Memory |
| `graph_` | Node、Edge、Evidence、Inference | Graph |
| `search_` | Representation、FTS Map、Vector Metadata、Retrieval Feedback | Retrieval |
| `ai_` | 本地 Route/偏好、Run 元数据、加密 Payload 引用 | AI Gateway |
| `ops_` | Event、Outbox、Job、Quota、Deletion、Backup、Audit | Main/Worker |

Module 不能绕过 Interface 写其他前缀表。Renderer 和 Extension 对所有表都是零权限，因为它们根本拿不到连接。

## 5. Identity 与项目政策

### 5.1 `identity_user_profiles`

- `user_id`, `display_name`, `locale`, `timezone`, `avatar_object_ref?`
- `control_plane_subject_id?`：可选云账号引用，不是业务数据 Owner。
- `offline_license_expires_at?`, `entitlement_snapshot_version?`
- 不保存密码、云 Session 明文或 BYOK Key。

### 5.2 `identity_workspaces`

- `id`, `workspace_type personal|team_reserved`, `name_ciphertext?`, `status`
- `default_visibility`, `default_memory_scope`
- MVP 为单设备个人 Workspace；团队同步未定义前不得暗中把数据上云。

### 5.3 `project_clients`

- `name_ciphertext`, `aliases_ciphertext`, `industry_ciphertext?`, `sensitivity_level`
- `allow_cross_project_recall`, `allow_personal_learning`
- Client 名称属于业务内容，不进入控制面或普通日志。

### 5.4 `project_projects`

- `client_id`, `name_ciphertext`, `design_domain`, `stage`, `privacy_mode`
- `external_ai_policy deny|local_only|byok_allowed|managed_allowed|explicit_route_allowlist`
- `allowed_route_ids`, `allowed_provider_ids`, `require_zero_retention`, `allowed_processing_regions`
- `allow_cross_project_recall`, `allow_personal_learning`
- 每次 AI Run 保存 Policy Snapshot；子资源只能继承或收紧。

### 5.5 `project_design_cases`

- `project_id`, `title_ciphertext`, `problem_statement_ciphertext`, `phase`
- `business_goal_ciphertext`, `user_goal_ciphertext`, `acceptance_criteria_ciphertext`
- FTS5 使用解密后的受控 Representation 建索引，不把明文复制到普通诊断表。

## 6. Capture、Import 与 Asset Vault

### 6.1 `asset_capture_requests`

- `client_request_id`, `capture_mode`, `target_type`, `target_id`
- `source_url_ciphertext`, `page_title_ciphertext`, `user_reason_ciphertext`, `note_ciphertext`
- `status received|persisted|queued|processing|ready|partial|failed|cancelled`
- `asset_id?`, `last_error_code`, `retry_count`
- 唯一 `(workspace_id, client_request_id)`；Extension 重放不得重复创建。

### 6.2 `asset_import_batches`

- `status queued|active|succeeded|partial_failed|failed|cancelled`
- `file_count`, `accepted_count`, `succeeded_count`, `failed_count`
- `quota_date_utc`, `started_at`, `completed_at`
- CHECK `file_count between 1 and 500`。
- 部分唯一索引分别保证每 Workspace 最多一个 active、一个 queued。

### 6.3 `asset_import_items`

- `batch_id`, `client_file_id`, `ordinal`, `file_name_ciphertext`, `media_type`, `byte_size`, `sha256`
- `status accepted|processing|succeeded|failed|cancelled`, `asset_id?`, `job_id?`
- 唯一 `(workspace_id, batch_id, client_file_id)`；重试不重复扣日配额。

### 6.4 `asset_sources`

- `source_type`, `original_url_ciphertext`, `normalized_url_digest`, `platform`
- `work_title_ciphertext`, `author_name_ciphertext`, `brand_name_ciphertext`
- `license_type`, `commercial_use`, `reference_only`, `captured_at`
- AI 补充来源信息必须标明 Provenance，不可冒充网页原文。

### 6.5 `asset_assets`

- `source_id?`, `asset_type`, `title_ciphertext`, `mime_type`, `processing_status`
- `user_reason_ciphertext`, `user_note_ciphertext`, `ai_description_ciphertext`, `confirmed_description_ciphertext`
- `content_sha256`, `perceptual_hash`, `width`, `height`, `duration_ms`, `page_count`, `byte_size`
- `inbox_state`, `copyright_status`, `is_user_original`

### 6.6 `asset_files`

- `asset_id`, `file_role original|preview|thumbnail|ocr_source|fragment`
- `object_ref`, `key_ref`, `algorithm_version`, `byte_size`, `sha256`, `status`
- `object_ref` 指向 AssetVault 随机对象；唯一 `(workspace_id, object_ref)`。
- 不存在 Cloud Bucket/Storage Path/Signed URL。

### 6.7 Fragment、Feature、Board 与 Usage

保留：

- `asset_fragments`：父 Asset、标准化坐标、用户原因、确认状态、Fragment Object Ref。
- `asset_visual_features` / `asset_visual_feature_observations`：规范特征与来源。
- `asset_boards` / `asset_board_items`：灵感板与排序。
- `asset_usages`：Asset/Fragment 在 Project/Decision/Output 中的真实使用。

## 7. 需求、判断、决策与结果

本地表保持原领域拆分：

- `project_source_documents` / `project_source_document_versions` / `project_source_document_chunks`
- `project_requirement_sets` / `project_requirement_statements`
- `project_requirement_interpretations` / `project_ambiguous_term_occurrences`
- `project_requirement_conflicts` / `project_hypotheses`
- `project_judgment_frameworks` / `project_judgment_dimensions` / `project_judgment_criteria`
- `project_design_propositions` / `project_proposition_tradeoffs`
- `project_evidence`
- `project_decisions` / `project_decision_alternatives`
- `project_feedback` / `project_outcomes` / `project_metrics`
- `project_reviews`

正文与原句字段使用 Envelope Encryption；状态、Scope、认知类型、来源引用、版本和时间列化。AI 产物只能进入 Draft/Candidate 字段或 `ai_artifacts`，不能直接写 Confirmed Decision。

## 8. Memory

### 8.1 `memory_candidates`

- `candidate_type`, `statement_ciphertext`, `payload_ciphertext`
- `origin`, `epistemic_type`, `suggested_scope`, `confidence`, `risk_level`
- `status observed|inferred|pending|confirmed|rejected|deleted`
- `source_type`, `source_id`, `source_version`, `fingerprint`

### 8.2 `memory_memories`

- `memory_type`, `statement_ciphertext`, `payload_ciphertext`
- `status observed|confirmed|validated|challenged|deprecated|deleted`
- `memory_scope`, `project_scope`, `client_scope`, `design_domain`
- `confidence`, `decay_policy`, `decay_weight`, `last_validated_at`, `last_recalled_at`

### 8.3 关联表

- `memory_evidence`
- `memory_conflicts`
- `memory_revisions`（硬删时不能无限保留旧正文）
- `memory_recall_events`
- `memory_user_models`（可重建投影）
- `memory_dictionary_terms/senses/examples/usages`

Memory T0 后同步清除 FTS/Vector/Graph/UserModel 可见性；Purge 才物理擦除加密 Payload 和 Evidence。

## 9. Graph

### 9.1 `graph_nodes`

- `node_type`, `canonical_entity_type`, `canonical_entity_id`
- `label_ciphertext?`, `epistemic_type`, `status`, `scope`, `ontology_version`
- 业务实体仍是事实源；Node 是可重建投影。

### 9.2 `graph_edges`

- `subject_node_id`, `predicate`, `object_node_id`
- `epistemic_type`, `status proposed|confirmed|challenged|deprecated|deleted`
- `confidence`, `scope`, `valid_from`, `valid_to`, `ontology_version`
- 唯一性包含方向、Scope、来源/版本，不能把不同 Client 的相似关系合并。

### 9.3 关联表

- `graph_edge_evidence`
- `graph_inference_traces`
- `graph_edge_conflicts`
- `graph_node_type_registry` / `graph_edge_type_registry`

有限路径查询在 SQLite 邻接表执行；没有 Neo4j，也没有云 Graph。所有查询先由 Main/Module 注入 Workspace/Client/Project 条件。

## 10. FTS5 与 LocalVectorIndex

### 10.1 FTS5

建议按访问与权重拆分：

- `search_assets_fts`
- `search_projects_fts`
- `search_memories_fts`
- `search_sources_fts`

FTS Row 与业务 Entity 通过 `search_fts_registry(entity_type, entity_id, content_version, index_status)` 映射。写业务正文与更新 FTS 必须通过同一 Module 事务/Outbox 形成可恢复链路。T0 先删除 FTS Row 或把 Registry 标记不可见，再返回删除成功。

中文策略由 M0 Fixture 验证：FTS5 负责精确词、规范化 Token 和 Prefix；语义与模糊意图由 LocalVectorIndex/应用层分词补足。不要提前把一个未经验证的 Tokenizer 写成架构信仰。

### 10.2 `search_vector_records`

仅存元数据：

- `entity_type`, `entity_id`, `content_version`, `content_digest`
- `embedding_route`, `embedding_model`, `dimensions`, `embedding_kind`
- `index_adapter`, `index_version`, `adapter_record_ref`, `status`
- `project_scope`, `client_scope`, `generated_by_ai_run_id`

实际向量由 LocalVectorIndex Adapter 管理，永不进入控制面。`adapter_record_ref` 不能成为业务外键。

### 10.3 LocalVectorIndex Adapter 约束

- `SqliteVecAdapter` 是候选生产 Adapter，封装所有 `vec0`/Extension SQL。
- `ExactVectorAdapter` 是测试 Oracle、小数据降级和删除一致性基线。
- 同一模型/维度/模态使用独立 Index Version；迁移采用双建、离线 Eval、切读、删除旧 Index。
- Filter 必须在候选生成前或 Adapter 内安全收敛，禁止全库 Top-K 后再删 Scope。
- T0 `remove` 失败时 Query 仍必须通过 Registry Tombstone 防泄漏；T+8 重试物理删除。

## 11. AI 本地记录与三 Route

### 11.1 `ai_provider_configs`

- `route_type local|byok|managed`
- `provider_key`, `adapter_version`, `endpoint_ciphertext?`, `secret_key_ref?`
- `data_retention_mode`, `processing_region?`, `enabled`
- BYOK Secret 只通过 KeyProtector 引用；Local Endpoint 需显式标记是否仅本机/局域网。

### 11.2 `ai_model_catalog_cache`

- 控制面 Catalog 的去内容化本地快照：Provider/Model/Capability/价格/Eval Approval/过期时间。
- 本地自定义 OpenAI-compatible 模型可建 Local Catalog Entry，但仍需能力探测与本地 Eval 状态。
- Catalog Cache 不是业务内容，可离线使用到明确过期策略。

### 11.3 `ai_user_model_preferences` / `ai_task_model_overrides`

- 按 Capability 保存默认和任务覆盖。
- Preference 只指向 Catalog Entry；每次 Run 仍重算 Project Policy、Route 可达性、Schema/Eval 和 Managed Budget。

### 11.4 `ai_runs`

- `route_type`, `capability`, `provider_id`, `catalog_entry_id`, `prompt_version`, `schema_version`
- `status`, `started_at`, `completed_at`, `latency_ms`, `error_code`
- `input_units`, `output_units`, `image_count`, `estimated_cost`, `actual_cost`
- `project_policy_snapshot`, `selection_source`, `trace_id`
- 原始内容不在该表；本地需要复盘时引用加密 Vault Payload。

### 11.5 `ai_run_payloads`

- `ai_run_id`, `payload_type`, `object_ref`, `key_ref`, `expires_at`, `redaction_status`
- 只存在本地 AssetVault。Managed Gateway 和控制面不得创建对应云 Payload。

### 11.6 Managed Budget

`ai_managed_budget_accounts` / `ai_managed_budget_ledger` 只核算 Managed Route：

- 用户 UTC 自然月 Soft `$15`、Hard `$20`。
- `settled + reserved + maximum_authorized_run_cost` 原子预留。
- Local/BYOK Run 的 `platform_billable = false`，不得消耗或伪装成 Managed Ledger。
- 控制面只接收 Usage ID、单位数、费用、Route/版本、状态和不可逆请求摘要；不接收 Project ID、文件名或语义。

## 12. Job、Import、Audit 与 Backup

### 12.1 `ops_jobs`

- `job_type`, `dedupe_key`, `payload_object_ref?`, `payload_minimal`, `status`
- `priority`, `attempt`, `max_attempts`, `available_at`, `lease_owner`, `lease_expires_at`, `heartbeat_at`
- `last_error_code`, `cancel_requested_at`, `completed_at`
- Job Payload 大字段进入本地加密 Vault；App 关闭时保持状态，下次启动恢复。

至少包含：

- `import.batch.process`
- `import.item.process`
- `asset.preview.generate`
- `search.fts.rebuild`
- `search.vector.embed/rebuild`
- `graph.project`
- `memory.consolidate`
- `deletion.local_purge`
- `deletion.verify_app_managed`
- `backup.create/verify/prune`

### 12.2 `ops_outbox_messages` / `ops_domain_events`

- 与领域变更同一 SQLite 事务写入。
- Event Payload 最小化；敏感正文使用 Entity Ref + Version，不复制。
- Dispatcher 物化幂等 Job；处理后标记，不依赖远程 Broker。

### 12.3 `ops_quota_counters`

- `quota_key=import_files_received`, UTC 日窗口，`used`, `limit=2000`。
- Batch 状态与部分唯一索引是 active/queued 槽位唯一事实源，不维护第二套槽位计数。
- 创建 Batch 的 SQLite 事务同时检查 500、槽位和日计数。

### 12.4 `ops_audit_logs`

- 仅保存动作、对象类型、本地不可逆 Actor 标识、结果、Reason Code、前后摘要和时间。
- 不保存正文、文件路径、Prompt、BYOK Key、向量、Bridge Token。

### 12.5 `ops_app_backups`

- `backup_id`, `created_at`, `coverage`, `object_ref`, `key_ref`, `sha256`, `verified_at`, `expires_at`, `status`
- Backup 必须加密并定期恢复演练；只覆盖 App-managed DB/Vault/Vector 必要内容。
- 用户的 Time Machine/iCloud/OneDrive/磁盘镜像不登记为 App Backup，也不在删除证书中伪装可控。

## 13. Extension 本地队列

Extension IndexedDB 不属于 SQLite，但必须共享协议契约：

- `client_item_id`, `created_at`, `expires_at`, `payload_kind`, `byte_size`, `sha256`
- `status pending|sending|acked|failed|expired`, `attempt`, `last_error_code`
- 加密/最小化 Payload Blob；App Session/Bridge Token 不持久化。
- 默认最多 500 项、1 GB、7 天；超限拒绝新项并提示。
- Native Host 重连后按 Client Item ID 幂等 Ack。
- 删除请求要向 Extension 发 Tombstone；Extension 不可达时证书记录 `extension_queue_pending`，不能假装已清。

## 14. 删除请求与证书

### 14.1 `ops_deletion_requests`

- `target_type`, `target_id`, `requested_by`, `requested_at`
- `recoverable_until`, `purge_after`, `completion_due_at`
- `status tombstoned|recoverable|purge_queued|purging|pending_device_execution|pending_extension|verified|failed`
- `last_app_seen_at`, `purge_started_at`, `verified_at`
- `certificate_id?`, `last_error_code`

### 14.2 `ops_deletion_checks`

每类介质一行：

- `surface app_db|vault|fts|vector|graph|cache|jobs|extension_queue|app_backup`
- `status pending|verified|unreachable|excluded|failed`
- `checked_at`, `remaining_count`, `checker_version`, `result_digest`

### 14.3 `ops_deletion_certificates`

- `coverage`, `exclusions`, `pending_surfaces`, `generated_at`, `certificate_version`, `certificate_digest`
- 不保存被删正文、路径、向量或可反推关系。
- Coverage 只包括 App 管理的 DB/files/FTS/vector/graph/cache/jobs/Extension Queue/App Backup。
- Exclusion 固定披露 OS Snapshot、iCloud/OneDrive/Time Machine、用户导出、第三方备份和 Provider Retention。
- 若设备从 T0 后持续未运行，T+30 时仍为 `pending_device_execution`；下一次启动补偿执行后才能生成 Verified Certificate。

## 15. 可选 Supabase 控制面 Schema

控制面与本地业务数据物理隔离，允许表仅包括：

- `accounts`
- `devices`（最小设备授权/撤销，不存本地路径/项目）
- `licenses`
- `entitlements`
- `billing_customers`
- `model_catalog_entries`
- `model_capability_approvals`
- `managed_ai_budget_accounts`
- `managed_ai_usage_ledger`
- `app_releases`

控制面字段禁止名单：

- Asset/Project/Client/Memory/Decision ID 的可关联明文；
- 业务正文、文件名、URL、图像、Embedding、Graph；
- 原始 Prompt、Context、Response、Tool Trace；
- BYOK Key、Local Model Endpoint、Extension Queue。

控制面 Migration 放在独立目录、独立包；本地 SQLite Migration 不能依赖控制面成功。Singapore 只是上述控制表的主区域。

## 16. M0 数据 Spike

### 16.1 SQLite

- Electron 打包 Driver 在 macOS/Windows 的签名、Migration、WAL、Busy、Crash Recovery。
- Main 单写 + 多 Utility Worker Command 压力；10k/100k Asset/Memory/Graph/Job Fixture。
- FTS5 中文 Query、删除、重建和 Version 切换。

### 16.2 Vector

- `sqlite-vec` pre-v1 Adapter 的加载、打包、签名、Top-K、过滤、删除、重建、维度升级。
- Exact Adapter 对同一小数据集输出 Oracle；差异必须解释。
- Spike 失败时的 Exact-only 数据上限和性能提示。

### 16.3 Encryption

- Electron `safeStorage` 的可用/暂不可用/轮换与 Linux Keyring 差异。
- 敏感 DB 字段、Vault 大文件、WAL/Temp/Crash/Backup 明文扫描。
- Key 丢失、换系统账号、恢复备份、对象级删除与密钥销毁。

### 16.4 控制面 DLP

- 使用 Canary Sensitive Fixture 证明控制面、Managed Telemetry、Crash/Logs 无内容。
- Schema Allowlist 阻止新增 Text/JSON 字段偷偷承载业务 Payload。
- Managed Gateway Request/Response Body 零持久化与下游 Provider Policy 披露。

## 17. Migration 与验收门

- 全新设备可从零 Migration 并 Seed。
- 旧 App 升级中断后能恢复；不出现双写半状态。
- Renderer/Extension 无 SQLite 路径、连接和 Vault Key。
- T0 后普通查询、FTS5、Vector、Graph、Cache、Job、AI Context 命中为 0。
- `SqliteVecAdapter` 与 Exact Oracle 在冻结 Fixture 上达到一致性门；Adapter 可替换不改业务 Module。
- 50 个并发导入创建仍只有 1 active + 1 queued；501/第三批/2,001 正确拒绝。
- Managed `$20` Hard Cap 并发不超发；Local/BYOK 不进入 Managed Ledger。
- 敏感 Fixture 不出现在 SQLite 明文、WAL、Temp、日志、控制面和 Managed Telemetry。
- 删除证书 Surface 完整；离线设备/不可达 Extension 正确保持 Pending。
- App-managed Backup 可恢复；外部 OS/云备份始终作为 Exclusion 披露。

以上模型的核心不是“把 PostgreSQL 语法翻译成 SQLite”。真正的变化是：业务数据主权回到设备，Main 成为可信事务入口，云端退回控制面，所有同步与删除承诺都必须服从设备是否可达这一现实。
