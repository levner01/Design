# MVP 发布检查清单（Local-first）

版本：v1.0  
用法：每项记录 Owner、证据 URI、Git SHA、平台和结论；`P0` 未通过即 No-Go。

## 1. 产品与目标用户

- [ ] `P0` 首批封测只围绕品牌设计师、网页视觉设计师建立样本与任务。
- [ ] `P0` Link/Viewport → Asset → Brief → Evidence → Decision → Memory → Project B Recall 可达。
- [ ] `P0` Full Page/Region/Page Image、Import、Fragment、Review、Dictionary、Reverse Memory 可达。
- [ ] `P0` 无账号、无互联网可完成本地核心与手工路径。
- [ ] 不自动评判审美、不替用户选择最佳、不把产品名工作代号写死。

## 2. Local-first 数据面

- [ ] `P0` Asset、Artifact、Client、Project、Brief、Evidence、Decision、Memory、Graph、Job、Audit 事实仅在本地加密数据库/对象目录。
- [ ] `P0` FTS5 与 sqlite-vec 在 macOS/Windows 安装包内可创建、升级、查询、重建、删除。
- [ ] `P0` LocalObjectStore 原子写入、加密、校验、临时/孤儿回收通过。
- [ ] `P0` 空库与上一版本 Migration 前滚；失败/kill 后可恢复。
- [ ] `P0` WAL、临时文件、预览、Crash report 和诊断包无未批准明文。
- [ ] 1,000 Asset 下分页、预览、本地搜索达到目标。

## 3. Electron 与密钥安全

- [ ] `P0` `contextIsolation=true`、`sandbox=true`、`nodeIntegration=false`，CSP/导航/窗口/权限受控。
- [ ] `P0` Renderer 只能调用版本化窄 Preload Interface；不存在通用 channel/任意 SQL/fs/shell。
- [ ] `P0` Main 对每个 IPC 重新做 Schema、来源、状态和授权校验。
- [ ] `P0` DB/Object/BYOK Key 使用 OS 安全存储；不进入 DB/env/log/Bundle/Crash dump。
- [ ] `P0` Key 丢失/错误/轮换中断有明确阻断或恢复，不静默创建新库覆盖旧数据。

## 4. Extension、Native Host 与 Local Bridge

- [ ] `P0` Native Messaging manifest 安装/卸载在 macOS/Windows 可复现。
- [ ] `P0` Bridge 只绑定 Loopback 随机端口；短期 Token/nonce、版本、重放/来源/限流通过。
- [ ] `P0` 任意网页、本机未授权进程、旧 Token 和伪 Origin 调用全部拒绝。
- [ ] `P0` Desktop 停止、浏览器重启、无网、权限拒绝、响应丢失时输入不丢且不双写。
- [ ] `P0` 五种采集共用一个 Capture Contract；失败步骤可单独重试。
- [ ] `P0` Extension 本地队列有容量、清理、加密/最小暂存和升级策略。

## 5. 可选 Control Plane

- [ ] `P0` Supabase 仅保存批准的账号、设备、Entitlement、签名配置/Catalog、Managed 用量聚合。
- [ ] `P0` 云端表、日志、函数、对象和抓包无截图、文件、Brief、Project、Decision、Memory、Graph、Embedding、搜索词、Prompt/Response 正文。
- [ ] `P0` 拒绝任何超出 Metadata Allowlist 的字段。
- [ ] `P0` Control Plane/互联网不可用不阻塞本地启动、读写、搜索、项目、记忆和删除。
- [ ] 账号解绑/元数据删除证书与本地内容删除证书明确分开。

## 6. AI Route、隐私与成本

- [ ] `P0` Local、BYOK Direct、Managed Stateless 的模型、能力、数据去向、网络需求和成本归属可见。
- [ ] `P0` BYOK Key 只在设备安全存储，BYOK 请求从设备直连，不经 Control Plane/Managed Gateway。
- [ ] `P0` Managed Gateway 不持久化 Prompt、Response、图片、Brief 或 Memory 正文；日志脱敏审查通过。
- [ ] `P0` Provider 自身留存/训练政策明确披露，产品不虚假承诺“绝不留存”。
- [ ] `P0` 所有 AI 输出绑定 Route/Model/Prompt/Schema/Policy/来源和状态；非法输出零业务写入。
- [ ] `P0` Managed `$15` 软提醒、`$20` 硬上限；失败/重试计费；并发/换模型/Fallback 不可绕。
- [ ] `P0` Local/BYOK 不被平台 Managed 预算错误阻断。
- [ ] `P0` AI/预算/网络失败时保留手工与本地关键词/既有向量路径。

## 7. 项目、决策与记忆

- [ ] `P0` Brief Revision 不可覆盖；需求分析有引用与认知类型。
- [ ] `P0` Evidence 含正例、反例、边界、来源和 Why Recalled。
- [ ] `P0` 最终 Decision 只能由用户保存；反馈/Outcome 追加不覆盖历史。
- [ ] `P0` 重要长期 Memory 零自动确认；无隐藏人格、能力或审美评分。
- [ ] `P0` Project B 召回 A 已确认 Memory；异 Client/Private/未确认/已删为 0。
- [ ] `P0` Dictionary 按个人/客户/项目 Scope；Reverse Memory 有证据、可关闭。

## 8. 冷启动导入与容量

- [ ] `P0` 每批最多 500；每本地资料库 1 active + 1 queued；单日 2,000，以已批准时区口径执行。
- [ ] `P0` 并发提交不能绕过配额；第三批/第 501/第 2,001 有明确错误。
- [ ] `P0` 部分失败不回滚成功项；单项重试/跳过/取消/重启恢复通过。
- [ ] 大文件、磁盘空间不足、解析失败、重复内容有明确提示。
- [ ] 交互 Capture 不因批量 Import 长期饥饿。

## 9. 删除、恢复与证明

- [ ] `P0` 普通删除 7 天可恢复；恢复后引用/索引一致。
- [ ] `P0` 永久请求立即使内容不再出现在查询、FTS5、sqlite-vec、Graph、Memory Recall、AI Context、缓存。
- [ ] `P0` Purge 覆盖 DB/FTS/vec/Graph/Job/Cache/Object/Preview/Temp/App 管理导出，并幂等可重试。
- [ ] `P0` App 未运行、设备离线或磁盘不可访问时状态为 `pending_device_execution`，绝不显示 Completed。
- [ ] `P0` App 获得执行机会后按 30 天 SLA 监测；逾期有本地提醒/诊断。
- [ ] `P0` Completed 证书列 Included/Excluded/Pending，不含正文/向量。
- [ ] `P0` 证书明确排除 Time Machine/File History/企业备份、用户副本、Local/BYOK/Managed Provider 留存。
- [ ] Control Plane 元数据删除证明不冒充本地业务删除证明。

## 10. Evals、故障与性能

- [ ] `P0` Local Data、Electron、Bridge、AI 外发、Scope、Memory、Deletion 红队全绿。
- [ ] `P0` Prompt Injection/恶意网页不能调用系统能力或改变业务 Policy。
- [ ] `P0` DB 锁、磁盘满、App kill、休眠、Provider/Control Plane 故障、队列重试演练完成。
- [ ] `P0` 关键词搜索 P95<1s、混合搜索 P95<3s 目标有代表性本地证据；超时降级。
- [ ] `P0` Evals 关联 Git/Route/Model/Prompt/Schema/Policy/Dataset 与成本；安全硬门不取平均。
- [ ] 诊断/可选遥测无正文、路径、搜索词、Key 和客户材料。

## 11. 双平台打包、更新与回滚

- [ ] `P0` macOS 与 Windows 全新安装、卸载、升级、回滚可复现。
- [ ] `P0` 原生 SQLite/加密/sqlite-vec/Native Host 在签名安装包内工作，不只开发态。
- [ ] `P0` 更新先做兼容检查/Migration；中断不损坏资料库；旧 App 不误开新 Schema。
- [ ] `P0` Extension Contract 至少兼容一个旧版本或给出强制升级安全路径。
- [ ] `P0` 安装器、Extension、Native Host、SBOM、签名/公证、许可证清单齐全。
- [ ] 回滚不回退/破坏已迁移用户数据；必要时前向修复。

## 12. 封测运营与 Go/No-Go

- [ ] `P0` 10–15 名品牌/网页视觉设计师招募标准与真实任务明确。
- [ ] `P0` Onboarding 说明数据在本地、备份责任、三 AI Route、删除证书边界。
- [ ] `P0` 反馈入口默认不附正文/截图；用户明确选择后才附加。
- [ ] `P0` 九个固定门全绿；P0 缺陷为 0；证据包关联发布 SHA。

| 签署 | 必须确认 | 结论 | 证据 |
|---|---|---|---|
| 产品/Codex | 范围、两项目闭环、任务卡验收 | 待填 | 待填 |
| GLM 实现 | 代码、Migration、双平台包、偏差 | 待填 | 待填 |
| 本地数据/安全 | SQLite/Object/vec、IPC/Bridge/Key、删除 | 待填 | 待填 |
| AI | 三 Route、外发、Evals、Managed 预算 | 待填 | 待填 |
| QA/Release | E2E、容量、安装、升级、回滚 | 待填 | 待填 |

出现用户业务内容上云、Renderer/Extension 越权、Bridge 未授权、长期记忆自动确认、删除后命中、离线假完成或 Managed 预算绕过，直接 No-Go。

