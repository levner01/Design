# MVP Epic、Story 与开发任务基线

版本：v1.1 Local-first
状态：已确认；GLM 逐卡实现与自测，Codex 按阶段门禁统一验收

## 1. 已确认决策

- 首批封测：品牌设计师、网页视觉设计师。
- Desktop 是主产品；本地加密 SQLite 是业务事实源，FTS5/sqlite-vec 是本地索引，LocalObjectStore 保存文件。
- Supabase 仅为可选 Control Plane；无账号、断网、云端故障不影响核心流程。
- AI 为 Local、BYOK Direct、Managed Stateless 三 Route；`$15/$20` 只约束 Managed。
- 冷启动导入：500 文件/批、1 active + 1 queued、2,000/日。
- 删除：7 天可恢复；永久请求立即撤销本地使用；App 可执行时 30 天内清理 App 管理本地面并签发证书；设备离线诚实 Pending。
- 产品名暂不冻结；内部工作名不等于最终品牌。

## 2. 优先级

| 级别 | 定义 |
|---|---|
| P0-A | Link/Viewport → 本地 Asset → 项目决策 → 记忆 → 第二项目召回 → 本地删除的纵向首验 |
| P0-B | 五采集、通用导入、Fragment、复盘、词典、反向记忆；阻塞完整 MVP |
| P1 | 云同步/备份、团队、专用连接器、Figma、公开发布与付费 |

## 3. Epic 总览

| Epic | 用户结果 | 优先级 | 依赖 |
|---|---|---:|---|
| E00 Electron 与本地可信基线 | 双平台安全运行、数据本地可迁移/删除 | P0-A | 无 |
| E01 Extension 与 Local Bridge | 无网/桌面暂停仍能采集且不丢 | P0-A/P0-B | E00 |
| E02 本地 Asset 与处理 | 原始素材即时可用，AI 异步增强 | P0-A | E01 |
| E03 AI Route 与本地检索 | 用户控制数据去向并离线搜索 | P0-A | E00/E02 |
| E04 本地客户、项目与 Brief | 真实项目原文版本化留在设备 | P0-A | E00 |
| E05 需求分析 | 有引用、可编辑、可手工降级 | P0-A | E03/E04 |
| E06 Evidence、Proposition、Decision | 正反证据与 Trade-off 可追溯 | P0-A | E03/E05 |
| E07 本地 Memory 与 Recall | 确认经验进入第二项目且不越 Scope | P0-A | E06 |
| E08 本地删除与证明 | 删除立即停止使用，证书诚实可验证 | P0-A | E02/E07 |
| E09 完整采集与导入 | 五模式和受配额冷启动导入 | P0-B | P0-A Gate |
| E10 Fragment、复盘、词典、反向记忆 | 局部与认知回写完整 | P0-B | P0-A Gate |
| E11 Evals、安全、容量与发布 | 双平台可封测、可更新、可回滚 | P0 | E00–E10 |

## 4. Epic 验收

### E00 Electron 与本地可信基线

- **范围**：Monorepo/Electron；本地持久化 Spike；LocalStore/LocalObjectStore/LocalVectorIndex；IPC/Key；可选 Control Plane。
- **验收**：加密 SQLite、FTS5、sqlite-vec 在 macOS/Windows 安装包内通过 Migration/Crash/Delete；Renderer 无 Node/db/fs/key；云端无业务表/内容。
- **No-Go**：Spike 失败后偷偷改云数据库；通用 IPC；登录阻塞本地。

### E01 Extension 与 Local Bridge

- **范围**：Native Messaging Host、随机 Loopback、短期 Token/nonce、重放防护、离线队列；五采集。
- **验收**：Desktop 停止后输入不丢；恢复只一个结果；Bridge 未授权调用为 0；不经云中转。
- **P0-A/P0-B**：Link/Viewport 为 P0-A；Full Page/Region/Page Image 为 P0-B。

### E02 本地 Asset 与处理

- **范围**：Capture、Local Jobs、Asset/Source/Artifact、正交状态、Inbox、版本/重复/来源。
- **验收**：AI 失败不影响原件；1,000 条可分页；进程 kill 可恢复；文件/索引只落本地。

### E03 AI Route 与本地检索

- **范围**：Local/BYOK/Managed、Catalog、Key、无状态 Gateway、Managed 预算、Vision/Embedding、FTS5/sqlite-vec/RRF。
- **验收**：数据去向明确；BYOK Key 不上云；Gateway 不存正文；Managed `$20` 不可绕；离线关键词/本地向量可用。

### E04 本地客户、项目与 Brief

- **范围**：Client/Project/Design Case、design_domain、Brief Revision、隐私/AI/Recall/Learning 策略。
- **验收**：两个真实项目离线可建；原文不可覆盖；无账号可用；异客户隔离。

### E05 需求分析

- **范围**：显性要求、模糊词、冲突、缺口、问题、判断维度、引用与认知类型。
- **验收**：推断不写事实；伪引用零写入；三 Route 外发最小化；AI 不可用可手工完成。

### E06 Evidence、Proposition、Decision

- **范围**：正反/边界证据、命题、风险、假设、选择/拒绝、Trade-off、Outcome。
- **验收**：用户才可保存最终决策；历史 Revision 不覆盖；离线完整可用。

### E07 本地 Memory 与 Recall

- **范围**：Candidate/Policy/确认/拒绝/Scope/冲突/衰减/调用/反馈。
- **验收**：重要记忆零自动确认；Project B 合法召回 A；异客户/未确认/已删为 0；Control Plane 无 Memory。

### E08 本地删除与证明

- **范围**：7 天恢复、Tombstone、Suppress、Purge、DB/FTS/vec/Graph/Job/Cache/Object/Temp/Export、Proof/Pending。
- **验收**：永久请求后立即零 Search/Recall/Context；离线为 Pending；Completed 只覆盖验证过的 App 本地面并排除 OS 备份/用户副本/Provider 留存。

### E09 完整采集与导入

- **范围**：Full Page/Region/Page Image；通用文件/图片/文档/链接/书签导入；500/1+1/2,000。
- **验收**：三采集失败不丢已有内容；配额本地事务不可绕；部分失败不回滚成功项。

### E10 Fragment、复盘、词典、反向记忆

- **范围**：Fragment/视觉 vec、Project Review、Dictionary Sense、Counter Evidence/Path Signal。
- **验收**：确认前不正式使用；复盘不编造；词义按 Scope；反向提醒有证据、可关闭、无审美评分。

### E11 Evals、安全、容量与发布

- **范围**：Local Data/Electron/Bridge/AI/Memory/Delete 红队；1,000 Asset/2,000 Import；双平台安装/升级/回滚、签名/公证、SBOM。
- **验收**：九门全绿、P0 缺陷 0、真实目标用户可独立完成 P0-A/P0-B。

## 5. 跨职能任务矩阵

| ID | 任务 | 核心验收 |
|---|---|---|
| T-01 | LocalStore 深模块 | 加密、迁移、事务、FTS5；无 DB 句柄外泄 |
| T-02 | LocalObjectStore 深模块 | 加密原子写、对象删除、临时/孤儿回收 |
| T-03 | LocalVectorIndex 深模块 | sqlite-vec 双平台、版本空间、100% 可删 |
| T-04 | Electron IPC/Key | 窄 Preload、OS Key、攻击集全绿 |
| T-05 | Native Host/Bridge | Loopback 认证、重放/来源/端口攻击全绿 |
| T-06 | Local Jobs | kill/休眠/重复恢复，删除/预算可取消 |
| AI-01 | 三 Route | Local/BYOK/Managed 数据去向和 Key 正确 |
| AI-02 | Managed 预算 | `$15` 软、`$20` 硬；并发/重试/换模型不可绕 |
| AI-03 | Structured Output | Schema/来源失败零业务写入 |
| D-01 | 本地事实模型 | Asset/Project/Decision/Memory/Graph 全本地 |
| D-02 | Migration | 空库+上一快照前滚，失败可恢复 |
| S-01 | 云数据面审计 | Control Plane 无任何业务内容/事实表 |
| S-02 | 删除证明 | Included/Excluded/Pending 真实准确 |
| Q-01 | P0-A E2E | 两真实项目、无账号、无网、删除 |
| Q-02 | P0-B E2E | 五采集、导入、Fragment、复盘、词典、反向 |

## 6. Definition of Done

1. 正常、空、加载、失败、重试、离线、锁定、磁盘满、删除状态有实现与测试。
2. Interface、错误、幂等、Migration、性能和数据外发有契约/证据。
3. Renderer/Extension 不接触系统能力；Main/Worker 重新校验。
4. AI 输出过 Schema/来源/Policy；Managed 预算原子执行。
5. 重要记忆用户确认；Project/Client Scope 零泄漏。
6. 用户内容不进入 Control Plane；三 Route 数据去向可解释。
7. 删除证书只陈述已验证范围；离线 Pending 不冒充完成。
8. GLM 完整交付，Codex 对当前卡给出 PASS，才算关闭。
