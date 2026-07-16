# MVP 里程碑（Local-first）

版本：v1.0  
原则：按可验证能力推进；不承诺无依据人日；每次只交一张 GLM 卡。

## Milestone 0：Electron 与本地数据可信基线

- **能力**：macOS/Windows Desktop 可安全启动、解锁和读写本地测试数据；无账号可用。
- **范围**：Monorepo/Electron；加密 SQLite+FTS5+sqlite-vec Spike；LocalStore/Object/Vector；IPC/Key；可选 Control Plane。
- **任务**：GLM-M0-01 → M0-05，严格串行。
- **验收**：双平台安装包内 Migration/Crash/Delete；Renderer 无 Node/db/fs/key；Control Plane 表/抓包无业务内容；断网可启动。
- **停线**：Spike 不通过则先 ADR，不得进入业务开发或改云主存储。

## Milestone 1：Extension 到本地收藏闭环

- **能力**：Link/Viewport 在 Desktop 停止或无网时排队，恢复后进入本地 Inbox。
- **范围**：Native Messaging Host、安全 Loopback Bridge、Extension 离线队列、本地 Capture Ingestion。
- **任务**：GLM-M1-01 → M1-03。
- **验收**：重放/伪来源拒绝；输入不丢/不双写；2 秒内已接收；零云中转。
- **暂不含**：全页、框选、单图，进入 Milestone 6。

## Milestone 2：本地素材理解与检索

- **能力**：Asset 无 AI 也可用；可选择 Local/BYOK/Managed 分析，并在本地搜索。
- **范围**：Local Jobs、Inbox、三 AI Route、Catalog、Managed 预算、Vision/Embedding、FTS5/sqlite-vec。
- **任务**：GLM-M2-01 → M2-04。
- **验收**：1,000 条可用；离线搜索；三 Route 抓包与 Key 安全；Managed `$20` 不可绕；删除索引零残留。

## Milestone 3：本地真实项目与需求分析

- **能力**：品牌/网页视觉设计师离线创建项目、导入文本 Brief、确认判断维度。
- **范围**：Client/Project/Design Case、Revision、策略、Requirement Analysis。
- **任务**：GLM-M3-01 → M3-02。
- **验收**：原文不可覆盖；引用与认知类型完整；AI 不可用可手工继续；两个项目互不串数据。

## Milestone 4：本地证据与决策

- **能力**：组织正反/边界证据，保存命题、选择、放弃、Trade-off 和 Outcome。
- **范围**：Evidence Board、Proposition、Decision Revision、Outcome。
- **任务**：GLM-M4-01 → M4-02。
- **验收**：用户才可保存最终决策；证据来源可追溯；无网可完整完成。

## Milestone 5：本地记忆闭环与删除

- **能力**：Project A 记忆经确认后在 B 召回；删除立即停用并最终签发诚实证书。
- **范围**：Memory Policy/Candidate、Recall/冲突/衰减、7 天恢复、Purge/Proof/Pending。
- **任务**：GLM-M5-01 → M5-03。
- **验收**：重要记忆零自动确认；异客户 0；永久删除立即零 Search/Recall/Context；离线设备显示 Pending；Completed 证书不声称覆盖 OS 备份/用户副本/Provider 留存。

## GATE-P0A：纵向首验

- 两个真实品牌/网页视觉项目完成全链路。
- 无账号、无互联网、Control Plane/Managed Gateway 停止时核心与手工路径可用。
- Local/BYOK/Managed 数据去向可核验；Managed 预算正确。
- Local Data/Desktop Security/Bridge/Contract/Evals/P0-A E2E 全绿。

未通过，不进入 Milestone 6。

## Milestone 6：完整 MVP P0-B

- **能力**：五采集、受配额导入、Fragment、复盘、词典、反向记忆。
- **任务**：GLM-M6-01 → M6-08。
- **验收**：Full Page/Region/Page Image 失败可降级；500/1+1/2,000 不可绕；视觉空间独立；复盘不编造；词义按 Scope；反向提醒有证据可关闭。
- **边界**：不做专用连接器、云同步/备份、团队、Figma。

## Milestone 7：质量、容量与发布

- **能力**：目标设计师可在 macOS/Windows 独立安装、升级、回滚并完成 MVP。
- **范围**：Evals/红队、容量/诊断、签名更新、Onboarding、Extension/Native Host 安装、SBOM。
- **任务**：GLM-M7-01 → M7-03。
- **验收**：九门全绿；P0 缺陷 0；双平台安装/迁移/回滚；数据外发红队；删除 Pending/Completed；10–15 名目标用户封测可启动。

## 推进规则

1. 每次只下发一张 GLM 卡，上一卡 Codex PASS 后继续。
2. 不以页面完成代替跨层能力、故障和删除验收。
3. 用户内容上云、Renderer/Extension 越权、Bridge 未授权、Memory 自动确认、删除后命中、离线假完成，立即 No-Go。
4. P0-A 成立前不横向扩 P0-B；P0-B 未完成不发布完整 MVP。
5. Supabase/Managed Gateway 故障不得等同产品不可用；本地核心必须继续。

