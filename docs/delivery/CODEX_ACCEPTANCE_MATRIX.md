# Codex Local-first 开发验收矩阵

版本：v2.0  
状态：逐卡验收基线

## 1. 验收等级

| 等级 | 内容 | 结论 |
|---|---|---|
| H0 | 内容外发、IPC/Bridge、密钥、删除、迁移、Managed 预算 | 只允许 PASS / REJECT |
| H1 | 契约、幂等、领域不变量、P0 流程 | PASS；非核心展示才可条件通过 |
| H2 | 性能、诊断、兼容、双平台发布 | 可带明确截止卡条件通过 |

自动日志必须含命令、退出码、Git SHA、平台、环境和时间。UI 需 E2E + 录屏；数据需 Migration/故障/反查；AI 需 Schema/来源/Route/外发/成本；安全不得只给配置截图。

## 2. 固定门

| Gate | 命令 | 判定 |
|---|---|---|
| G-Q | `pnpm verify:quick` | Format/Lint/Type/依赖/单测/Build 非假绿 |
| G-LD | `pnpm verify:local-data` | 加密 DB/Migration/FTS5/vec/Object/删除 |
| G-DS | `pnpm verify:desktop-security` | CSP/IPC/Preload/Key/导航/Secret |
| G-BR | `pnpm verify:bridge` | Host/Loopback/认证/重放/队列 |
| G-CT | `pnpm verify:contract` | Main/Renderer/Worker/Extension/Host/AI Route |
| G-EV | `pnpm verify:evals:quick` | Schema/来源/Scope/Route/外发/冻结集 |
| G-A | `pnpm verify:e2e:p0a` | 两真实项目 Local-first 纵向闭环 |
| G-B | `pnpm verify:e2e:p0b` | 五采集/导入/Fragment/复盘/词典/反向记忆 |
| G-R | `pnpm verify:release` | 双平台包、迁移、容量、删除、签名/回滚 |

## 3. 逐卡矩阵

| 任务 | 级别 | 依赖 | 必跑门 | 关键证据 | 直接 REJECT |
|---|---|---|---|---|---|
| M0-01 | H1 | 无 | 安装/Build/TSC/双平台 smoke | 目录、依赖图、Desktop 包 | 云主应用/主 API；Renderer Node；技术栈漂移 |
| M0-02 | H0 | M0-01 | G-LD spike | 双平台 packaged app、错误 Key、Crash、vec/FTS 删除 | 只开发态通过；加密/vec 静默关闭；擅改云 DB |
| M0-03 | H0 | M0-02 | G-LD/G-CT/G-Q | 三 Interface、Migration、对象/vec/FTS 反查 | 暴露 DB/path/SQL；Migration 不可恢复；明文残留 |
| M0-04 | H0 | M0-03 | G-DS/G-CT/G-Q | IPC 清单、攻击、Key 生命周期、Bundle 扫描 | 通用 IPC；Renderer fs/db/key；Key 进日志/env/DB |
| M0-05 | H0 | M0-04 | G-CT/G-DS/G-Q | 云字段 Allowlist、离线录屏、抓包、表清单 | 上传业务内容；登录/云故障阻塞本地；云端业务表 |
| M1-01 | H0 | M0 全部 | G-BR/G-DS/G-CT | 双平台 Host、威胁模型、重放/伪来源 | 0.0.0.0；长期 Token；任意网页/进程可调用 |
| M1-02 | H1 | M1-01 | G-BR/G-DS/G-Q | Desktop 停止/重启、队列、零云抓包 | 输入丢失/双写；队列明文；云中转 |
| M1-03 | H1 | M1-02 | G-LD/G-BR/G-CT | 事务故障、对象关联、P95、五 mode contract | AI 阻塞保存；对象/行不一致；云对象存储 |
| M2-01 | H1 | M1-03 | G-LD/G-CT/G-Q | kill/休眠恢复、DLQ、重复一个结果 | 云 Queue；无限重试；重复领域结果 |
| M2-02 | H1 | M2-01 | G-LD/G-DS/G-Q | 1,000 Asset、状态矩阵、离线 UI | 单 status；Renderer 直存储；AI 失败不可用 |
| M2-03 | H0 | M0-04/05/M2-01 | G-DS/G-CT/G-EV/G-Q | 三 Route、抓包、Key 扫描、Managed 预算竞态 | BYOK Key 上云；Gateway 存正文；预算误套 Local/BYOK/可绕过 |
| M2-04 | H1 | M2-02/03 | G-LD/G-EV/G-DS | 离线搜索、P95、Recall、删除反查 | 云索引；非法 Schema 写入；Scope 后过滤 |
| M3-01 | H1 | M2-04 | G-LD/G-DS/G-Q | 两真实项目、Revision、离线 | Brief 可覆盖/上传云；策略只 UI |
| M3-02 | H1 | M3-01/M2-03 | G-EV/G-DS/G-Q | 引用、三 Route 抓包、手工降级 | 推断写事实；伪引用；AI 不可用阻断 |
| M4-01 | H1 | M2-04/M3-02 | G-LD/G-DS/G-Q | 正反/边界、Scope、离线 | 私密/异客户出现；证据经云检索；反证隐藏 |
| M4-02 | H1 | M4-01 | G-EV/G-LD/G-Q | Decision/Outcome 版本链 | AI 自动最终决策；历史覆盖；无证据伪装验证 |
| M5-01 | H0 | M4-02 | G-EV/G-LD/G-DS | 零自动确认、Policy、零云 | 自动 Active；客户偏好写个人；云存 Memory |
| M5-02 | H0 | M5-01 | G-EV/G-DS/G-Q | 两项目 Recall、Context 抓包 | 跨客户；候选进 Context；外发过量 |
| M5-03 | H0 | M5-02 | G-LD/G-DS/G-A | 全层反查、Pending→Completed、证书 | 删除后命中；离线假完成；证书声称 OS/Provider 留存 |
| M6-01 | H1 | GATE-A | G-BR/G-Q | 页面矩阵、内存、降级 | 云渲染；失败回滚已成功内容 |
| M6-02 | H1 | M6-01 | G-BR/G-Q | DPR/滚动坐标 | 采集选区外正文；页面永久污染 |
| M6-03 | H1 | M6-02 | G-BR/G-Q | 图片类型、来源、CORS | 绕过访问；宣称版权；抓全页图片 |
| M6-04 | H1 | GATE-A | G-LD/G-Q | 500/1+1/2,000 并发、日界线 | 配额可绕；云上传；成功项回滚 |
| M6-05 | H1 | GATE-A/M2-04 | G-LD/G-EV | 父链、视觉 Eval、删除 | 云 vec；未确认正式使用；父删子留 |
| M6-06 | H1 | GATE-A/M4-02 | G-EV/G-DS | Review 来源/版本/Route 抓包 | 编造；确认前写 Memory；历史覆盖 |
| M6-07 | H1 | GATE-A/M6-06 | G-LD/G-Q | 同词多 Scope、来源 | 个人覆盖客户；无证据生效；云同步 |
| M6-08 | H1 | GATE-A/M6-06/07 | G-EV/G-LD | 多项目、阈值、关闭 | 审美评分；无证据“总是”；关闭仍提醒 |
| M7-01 | H0 | M6 全部 | G-EV/G-DS/G-BR/G-LD | 数据卡、红队、差异、失败阻断 | 真实客户内容；安全取平均；退化不阻断 |
| M7-02 | H2 | M7-01 | G-DS/G-R 子门 | 压测、诊断抓包、成本、更新/回滚 | 诊断上传正文/path/query；更新破坏 DB |
| M7-03 | H0 | 全部 PASS | G-A/G-B/G-R | 双平台包/录屏、SBOM、签名、公证、回滚 | P0 缺陷；无网/无账号不可用；安装/升级不可复现 |

## 4. P0-A 场景

1. 无账号、无互联网启动 Desktop，创建本地资料库。
2. Desktop 暂停时 Extension 保存 Link/Viewport；重启后幂等落本地。
3. AI 不可用时 Asset 仍可查看、编辑、搜索和关联。
4. 用户分别理解 Local、BYOK、Managed 的数据去向；Managed 超 `$20` 只禁 Managed 增强。
5. 创建 Project A，导入本地文本 Brief，审阅有引用判断维度。
6. 本地召回正/反/边界证据，用户保存 Proposition/Decision/Outcome。
7. 系统只生成 Memory Candidate，用户确认 Scope。
8. Project B 本地召回 Project A 的已确认 Memory；异客户/私密零泄漏。
9. 永久删除后立即零本地 Search/Recall/AI Context。
10. App 不运行时状态为 `pending_device_execution`；再次启动完成清理后证书只覆盖 App 管理本地面。

任一步失败，P0-A 不通过。

## 5. 删除证书验收

Completed 证书必须列出：resource hash、request/suppress/execute/complete 时间、DB/FTS/vec/Graph/Job/Cache/Object/Temp/App-managed Backup 各面结果、失败重试、应用/数据版本。

必须列出 exclusions：OS/企业备份、用户复制导出、Local/BYOK/Managed Provider 留存。设备不可访问必须为 Pending，不能产生 Completed 时间。

## 6. 最终证据包

- Git/Node/pnpm/Electron/SQLite/FTS5/sqlite-vec/双平台版本。
- 九门完整日志与退出码。
- macOS + Windows 全新安装、升级、回滚、数据迁移。
- P0-A/P0-B 录屏与步骤索引。
- IPC/Bridge/Key/恶意网页/外发红队与抓包。
- 三 AI Route、Model/Prompt/Schema/Policy/Dataset 版本、Managed 成本。
- 1,000 Asset、2,000 Import、本地任务/休眠/磁盘/检索性能。
- 删除 Pending/Completed、全层反查和边界清晰的证书。
- Extension/Native Host 权限、安装器、SBOM、签名/公证。
- 未关闭 P0 缺陷必须为 0。
