# GLM 5.2 Local-first MVP 实施任务卡

版本：v2.0  
状态：逐卡下发  
协议：[HANDOFF_PROTOCOL.md](HANDOFF_PROTOCOL.md)  
验收：[CODEX_ACCEPTANCE_MATRIX.md](CODEX_ACCEPTANCE_MATRIX.md)

## 1. 执行规则与依赖

- 任意时刻只允许一张卡 `IN DEVELOPMENT`；本文不是一次性交给 GLM 的大包。
- 每卡“修改目录”是 Allowlist；默认禁止改产品、架构、交付基线。
- 每卡必须先通过 `pnpm verify:quick`，再通过列出的专项门。
- M0 必须按编号串行；M1–M5 构成 P0-A；P0-A 全绿后才进入 M6；M7 为发布硬化。

```text
M0 Electron + Local Data Foundation
→ M1 Extension ↔ Native Host ↔ Local Bridge
→ M2 Local Asset + Jobs + AI + Search
→ M3 Local Project + Brief
→ M4 Evidence + Decision
→ M5 Memory + Local Deletion
→ GATE-P0A
→ M6 P0-B
→ M7 Release
```

## 2. M0：Electron 与本地数据基线

### GLM-M0-01 Monorepo / Electron skeleton

- **目标**：建立 Node 24 + TypeScript Monorepo、Electron Desktop、Chrome Extension、Native Host、可选 Managed Gateway 空骨架和固定验收入口。
- **范围**：`apps/desktop` main/preload/renderer、`apps/browser-extension`、`apps/native-host`、`apps/managed-gateway`；packages/contracts/modules/platform/testing/ui；pnpm/Turbo/TS References；macOS/Windows 打包烟测。
- **禁止范围**：不实现业务；不创建 Web 主应用/云 API 作为核心；不引入 Python、微服务、ORM、Neo4j；不把最终产品名写死。
- **依赖**：无。
- **修改目录**：仓库根配置、`apps/**`、`packages/**`、`tests/**`、`evals/**`、`prompts/**`、`scripts/**`、`infra/**`、`.github/**`、`README.md`、`.env.example`。
- **Interface/Seam 要求**：Renderer 仅通过 Preload 暴露的窄 Interface；应用只依赖模块 Public Interface；Package Export Map 禁止私有穿透；Managed Gateway 空壳不得反向依赖业务模块。
- **实现任务**：骨架、Composition Root、基础 CSP、打包配置、九个验收脚本入口、依赖方向规则、全新环境说明。
- **测试任务**：全新安装、四应用构建、macOS/Windows CI 打包烟测、循环依赖、Renderer 无 Node、Extension Manifest 解析。
- **验收证据**：目录树、依赖图、安装/构建/双平台包日志、Desktop 启动截图、九脚本列表。
- **Codex 验收命令/门**：`corepack pnpm install --frozen-lockfile`；`pnpm build`；`pnpm exec tsc -b`；双平台 CI Artifact。
- **风险**：Electron 样板把 IPC 放宽；空包过度抽象；云端空壳被误当主后端。
- **完成定义**：新环境可启动安全空 Desktop；目录与 Local-first 依赖方向正确；无业务代码和云事实源。

### GLM-M0-02 本地持久化技术 Spike

- **目标**：用可运行证据验证加密 SQLite、FTS5、sqlite-vec、打包、Migration、删除和 macOS/Windows 兼容；失败时提交替代 ADR。
- **范围**：候选驱动/绑定；密钥打开；事务；WAL/锁；FTS5；sqlite-vec 插入/查询/删除；10k Fixture；Crash Recovery；Electron Packaged App 原生模块加载。
- **禁止范围**：不写领域表/Repository；不以开发态成功代替安装包；不静默禁用加密/向量；不改成云端数据库。
- **依赖**：GLM-M0-01。
- **修改目录**：`tests/spikes/local-persistence/**`、`scripts/**`、`tests/fixtures/**`、打包配置；ADR 候选只写入 GLM 交付报告，由 Codex 决定是否进入正式基线。
- **Interface/Seam 要求**：Spike 比较实现能力，不冻结业务 Interface；必须记录驱动、原生二进制、许可证、升级、备选与删除行为。
- **实现任务**：最小数据库；加密/错误密钥；FTS/vec；文件删改；WAL 恢复；双平台打包；体积/性能；失败替代方案。
- **测试任务**：错误 Key、断电/kill、并发读写、升级、100% vec 删除、FTS 清理、macOS arm64/x64、Windows x64 安装包。
- **验收证据**：Spike 报告、二进制/依赖清单、双平台 Artifact、性能/体积/删除反查、失败日志与 ADR 候选。
- **Codex 验收命令/门**：`pnpm verify:local-data -- --spike`；安装包内重复运行；人工审查替代 ADR。
- **风险**：原生模块 ABI；sqlite-vec 打包；SQLCipher/加密驱动许可证与性能；WAL 残留明文。
- **完成定义**：方案在双平台安装包内通过全部硬门；否则明确 `REJECT + ADR`，M0-03 不开始。

### GLM-M0-03 LocalStore / LocalObjectStore / LocalVectorIndex

- **目标**：把通过 Spike 的能力固化为三个深模块及可前滚 Migration，不泄漏数据库/文件/向量实现。
- **范围**：LocalStore 事务/查询/迁移/备份前检查；LocalObjectStore 加密原子写、读取、删除、临时/孤儿回收；LocalVectorIndex upsert/query/delete/version；FTS5 归 LocalStore；测试 Adapter。
- **禁止范围**：不写具体业务 Module；不把 SQL/Path/vec Row 暴露给 Renderer；不做云 Adapter；不提供万能 Repository/任意 SQL IPC。
- **依赖**：GLM-M0-02 PASS。
- **修改目录**：`packages/platform/local-store/**`、`local-object-store/**`、`local-vector-index/**`、`packages/testing/**`、`tests/local-data/**`、`scripts/**`、Desktop main Composition Root。
- **Interface/Seam 要求**：三 Module 各一个小 Interface；生产 Adapter + Test Adapter；事务只在 Main/Local Worker；向量空间/维度/模型版本显式；对象 ID 不等于可猜路径。
- **实现任务**：初始化/关闭、Migration journal、原子事务、FTS、对象加密/校验、vec namespace、删除枚举、健康检查。
- **测试任务**：空库/上一快照前滚、失败 Migration、错误 Key、进程崩溃、孤儿对象、vec/FTS 删除、路径穿越、并发访问。
- **验收证据**：Interface 文档、Migration 报告、故障注入、全层删除反查、无原始句柄导出扫描。
- **Codex 验收命令/门**：`pnpm verify:local-data`；`pnpm verify:contract`；`pnpm verify:quick`。
- **风险**：浅包装；Migration 不可恢复；临时文件/WAL 泄漏；多进程同时写。
- **完成定义**：业务调用者只学三个窄 Interface；双平台迁移与删除可靠；Renderer/Extension 无句柄。

### GLM-M0-04 Electron 安全 IPC 与 Key Management

- **目标**：建立最小权限 Electron 运行壳、版本化 IPC Contract 和本地密钥生命周期。
- **范围**：`contextIsolation/sandbox/nodeIntegration`、Preload allowlist、Schema/版本/错误、窗口导航/外链/权限、CSP、OS Keychain/DPAPI 安全存储、DB/Object Key 派生/轮换/锁定、审计。
- **禁止范围**：无通用 `invoke(channel,args)`；Renderer 无 fs/db/shell；Key 不进 DB/env/log/Crash report；不在 JS 长期缓存明文 Key。
- **依赖**：GLM-M0-03。
- **修改目录**：`apps/desktop/**`、`packages/contracts/**`、`packages/platform/key-management/**`、`packages/platform/observability/**`、`packages/testing/**`、`tests/desktop-security/**`。
- **Interface/Seam 要求**：每项用例一个窄 IPC Interface；Main 重新授权/校验；Key Provider 有 OS Adapter 与 Test Adapter；业务错误不暴露系统路径/SQL。
- **实现任务**：IPC Registry、Preload facade、请求来源/版本/Schema、CSP/导航、首次 Key、锁定/解锁、轮换、恢复失败说明。
- **测试任务**：XSS→Node、任意 channel、Prototype pollution、恶意 URL/窗口、错误 Key、OS Key 丢失、日志/Crash dump Secret 扫描。
- **验收证据**：Electron 安全清单、IPC 清单、攻击测试、Key 生命周期图、Bundle/日志扫描、双平台解锁录屏。
- **Codex 验收命令/门**：`pnpm verify:desktop-security`；`pnpm verify:contract`；`pnpm verify:quick`。
- **风险**：Preload 变万能桥；OS Key Store 差异；轮换半失败导致不可读。
- **完成定义**：Renderer 仅获得批准用例；Key 不可从 UI/日志/Bundle 提取；错误状态可恢复或明确阻断。

### GLM-M0-05 Supabase 可选 Control Plane

- **目标**：实现不阻塞离线核心的可选账号/设备/Entitlement/配置/Model Catalog/Managed 用量 Control Plane。
- **范围**：可跳过登录；设备注册/撤销；Entitlement；签名配置；Managed Route 月用量聚合；Control Plane Metadata 删除；断网缓存与降级。
- **禁止范围**：严禁上传 Asset、截图、Brief、Project、Decision、Memory、Graph、Embedding、搜索词、Prompt/Response 正文；不做云备份/同步；不让登录阻塞本地核心。
- **依赖**：GLM-M0-04。
- **修改目录**：`packages/platform/control-plane/**`、`apps/desktop/**` 账号设置、`apps/managed-gateway/**` 最小控制接口、`packages/contracts/**`、`infra/control-plane/**`、`tests/control-plane/**`、`.env.example`。
- **Interface/Seam 要求**：ControlPlane Interface 与业务 Module 隔离；Supabase Adapter + Offline/No-account Adapter；DTO 只允许元数据字段；内容字段以 Schema/静态扫描硬拒绝。
- **实现任务**：匿名本地模式；账号绑定；设备/Entitlement；签名 Catalog；用量聚合；断网缓存；元数据删除请求/证明。
- **测试任务**：完全离线启动、Control Plane 故障、恶意内容字段、抓包、账号解绑、本地数据仍可用、元数据删除。
- **验收证据**：字段 Allowlist、抓包、离线录屏、故障演练、Supabase 表清单证明无业务表、元数据删除证书。
- **Codex 验收命令/门**：`pnpm verify:contract`；`pnpm verify:desktop-security`；Control Plane 数据面扫描；`pnpm verify:quick`。
- **风险**：功能扩张成云同步；遥测带正文；账号状态误删本地数据。
- **完成定义**：拔网/停 Supabase 后本地业务完整可用；云端只存在批准元数据；任何内容字段被拒绝。

## 3. M1：Extension 与本地桥

### GLM-M1-01 Native Messaging Host 与安全 Local Bridge

- **目标**：建立 Extension 到 Desktop 的可信本机通信，支持发现、认证、版本协商、重放防护和最小权限。
- **范围**：Chrome Native Messaging manifest/host；127.0.0.1 随机端口；每会话短期 Token/nonce；来源/Origin 检查；TLS 或等价本机通道保护 ADR；健康/版本；限流。
- **禁止范围**：不绑定 `0.0.0.0`；不使用固定长期 Token；不允许任意网页调用；不经 Bridge 暴露 DB/fs；不上传云端中转。
- **依赖**：M0 全部 PASS。
- **修改目录**：`apps/native-host/**`、`packages/platform/local-bridge/**`、`apps/desktop/**` Main 接线、`apps/browser-extension/**` 通信层、`packages/contracts/**`、`tests/bridge/**`、打包/安装脚本。
- **Interface/Seam 要求**：Native Host 只做发现/握手；Local Bridge 只暴露 Capture/状态等批准 Interface；Contract 版本化；认证在每请求校验。
- **实现任务**：安装/卸载 manifest；握手；端口/Token 生命周期；nonce；请求限制；Desktop 重启重连；错误分类。
- **测试任务**：端口扫描、Token 重放、伪 Origin、本机恶意进程、Desktop 未运行、版本不兼容、Host 缺失、macOS/Windows 安装。
- **验收证据**：威胁模型、抓包、攻击测试、双平台安装录屏、版本/重连日志。
- **Codex 验收命令/门**：`pnpm verify:bridge`；`pnpm verify:desktop-security`；`pnpm verify:contract`。
- **风险**：Loopback 被 CSRF/本机进程滥用；安装 manifest 路径差异；Token 生命周期过长。
- **完成定义**：未授权调用全部拒绝；Desktop 重启可恢复；通信不依赖互联网且不暴露通用系统能力。

### GLM-M1-02 Extension 离线队列、Link 与 Viewport

- **目标**：完成 P0-A 的 Link/当前视口采集；Desktop 不在线时安全排队，恢复后幂等同步到本地。
- **范围**：MV3 Popup、最小权限、URL/标题/原因、Viewport、压缩、Extension 本地队列、容量/清理、Bridge 重连、幂等键、接收/分析状态分离。
- **禁止范围**：不在 Extension 长期存敏感 Token/截图；不实现全页/框选/单图；不因 Desktop/AI 不在线丢输入；不走云上传。
- **依赖**：GLM-M1-01。
- **修改目录**：`apps/browser-extension/**`、`packages/contracts/**`、`tests/bridge/**`、`tests/e2e/**`、`tests/fixtures/**`。
- **Interface/Seam 要求**：Chrome API 内部 Adapter；Extension 只调用 Bridge Capture Contract；队列状态与 Desktop Capture 状态显式映射。
- **实现任务**：Link/Viewport；可选原因；队列/退避/容量；重连；重复响应合并；权限拒绝降级 Link。
- **测试任务**：Desktop 退出→重启、浏览器重启、重复点击、截图拒绝、大图、Token 轮换、队列满、无网全流程。
- **验收证据**：离线录屏、队列导出、重复只一个结果、权限清单、本地/网络抓包无云请求。
- **Codex 验收命令/门**：`pnpm verify:bridge`；Extension E2E；`pnpm verify:desktop-security`；`pnpm verify:quick`。
- **风险**：MV3 worker 生命周期；本地队列明文；重复同步。
- **完成定义**：无互联网且 Desktop 暂停时输入不丢；恢复后只落一个本地 Capture；截图失败保留 Link/原因。

### GLM-M1-03 本地 Capture Ingestion

- **目标**：将 Bridge Capture 事务性写入 LocalStore/LocalObjectStore，2 秒内返回“已接收”，后续处理异步。
- **范围**：统一五 mode Capture Contract、输入/MIME/大小清理、对象原子写、Asset Shell、幂等、来源、失败补偿、后续 Local Job 入队。
- **禁止范围**：不为五 mode 复制流程；不执行页面脚本/HTML 指令；不写云对象存储；AI 不阻塞保存。
- **依赖**：GLM-M1-02、M0-03。
- **修改目录**：`packages/modules/capture/**`、`packages/modules/assets/**` 最小 Interface、`apps/desktop/**` Main/worker 接线、`packages/contracts/**`、`tests/local-data/**`、`tests/bridge/**`、`tests/e2e/**`。
- **Interface/Seam 要求**：Capture Interface 接受 mode/source/artifact/reason/target/idempotency；对象与元数据事务补偿隐藏在 Module 内；不暴露 Path。
- **实现任务**：事务/补偿；幂等；2 秒响应；部分 Artifact 失败；本地 Job；来源/许可 unknown。
- **测试任务**：重复请求、对象写成功/DB 失败、恶意 MIME、超大输入、截图失败 Link 成功、进程 kill、零云网络。
- **验收证据**：事务故障报告、对象/行关联、P95、网络抓包、五 mode Contract Fixture。
- **Codex 验收命令/门**：`pnpm verify:local-data`；`pnpm verify:bridge`；`pnpm verify:contract`；`pnpm verify:quick`。
- **风险**：对象/行双写；临时文件残留；幂等仅 Extension 实现。
- **完成定义**：Capture 在本地可靠落盘；任何 AI/Control Plane 故障不影响原始内容可用。

## 4. M2：本地 Asset、Jobs、AI 与 Search

### GLM-M2-01 Local Jobs / Outbox

- **目标**：用 LocalStore 建立至少一次、幂等、可取消、崩溃恢复的本地任务/Outbox。
- **范围**：状态机、租约/心跳、退避/Jitter、Dead Letter、Outbox、任务优先级、App 退出恢复、删除/策略取消。
- **禁止范围**：不引入云 Queue/Redis；Job 不携带大正文/Key；Handler 不复制业务规则；不无限重试。
- **依赖**：GLM-M1-03。
- **修改目录**：`packages/platform/local-jobs/**`、`apps/desktop/**` Local Worker、`packages/contracts/**`、`tests/local-data/**`、`tests/integration/**`。
- **Interface/Seam 要求**：LocalJob Interface 仅 submit/cancel/status；Handler 调业务 Module Interface；Test Scheduler 可控时间；幂等键含资源/输入/政策版本。
- **实现任务**：表/Migration；领取/租约；重试/DLQ；Outbox；进程恢复；前后台资源配额。
- **测试任务**：重复、并发、kill、休眠唤醒、租约过期、删除取消、429、永久错误、磁盘满。
- **验收证据**：状态图、Crash Recovery、重复一个业务结果、DLQ、休眠/重启录屏。
- **Codex 验收命令/门**：`pnpm verify:local-data`；Local Jobs 集成；`pnpm verify:contract`；`pnpm verify:quick`。
- **风险**：App 退出状态漂移；电源管理；重试烧 Managed 预算。
- **完成定义**：重启/崩溃不丢任务、不重复业务结果；删除和预算可取消任务。

### GLM-M2-02 Asset Pipeline、Inbox 与来源

- **目标**：原始 Asset 在 AI 前即可查看、编辑、关联、检索和删除，正交追踪 ingestion/analysis/organization。
- **范围**：Asset/Source/Artifact、Inbox/Library/详情、用户字段与 AI 字段分存、重复提示、1,000 条分页、文件预览。
- **禁止范围**：不使用单一 status；不让 AI 覆盖用户输入；不把来源当版权授权；不创建云 Asset 表。
- **依赖**：GLM-M2-01。
- **修改目录**：`packages/modules/assets/**`、`apps/desktop/**` Renderer/Main、`packages/ui/**`、`packages/contracts/**`、`tests/local-data/**`、`tests/e2e/**`。
- **Interface/Seam 要求**：Assets Module 集中查询/编辑/状态/来源/删除；Repository 内部；Renderer 只走 IPC 用例。
- **实现任务**：本地 Schema/Migration；状态；分页；预览；重复 hash；来源 unknown；空/加载/失败/重试 UI。
- **测试任务**：AI 永久失败、重复、文件失效、并发编辑、1,000 条、IPC 越权、Control Plane 断开。
- **验收证据**：状态矩阵、分页/P95、UI 录屏、本地 DB/Object 对照、零云抓包。
- **Codex 验收命令/门**：`pnpm verify:local-data`；`pnpm verify:desktop-security`；Asset E2E；`pnpm verify:quick`。
- **风险**：状态泥球；Renderer 直连存储；预览临时文件泄漏。
- **完成定义**：离线原始 Asset 始终可用；AI 失败独立恢复；1,000 条规模可用。

### GLM-M2-03 AI Route、Model Catalog 与预算

- **目标**：实现 Local、BYOK Direct、Managed Stateless 三条 AI Route，用户按能力选择模型，外发和成本透明。
- **范围**：Catalog/Capability；Route Policy；本地模型 Adapter；BYOK Key 本机安全存储并从 Desktop 直连；Managed Stateless Gateway；AI Run 元数据；Schema/超时/取消；Managed `$15/$20`。
- **禁止范围**：业务 Module 不 Import SDK/模型名；BYOK Key 不进 Control Plane；Managed Gateway 不持久化 Prompt/Response/截图/Brief；预算不约束 Local/BYOK；不允许任意裸 Model ID。
- **依赖**：GLM-M0-04、M0-05、M2-01。
- **修改目录**：`packages/platform/ai/**`、`packages/platform/key-management/**`、`apps/managed-gateway/**`、`apps/desktop/**` 设置/接线、`packages/contracts/**`、`prompts/**` Manifest、`tests/ai/**`、`tests/desktop-security/**`、`infra/managed-gateway/**`。
- **Interface/Seam 要求**：Model Capability Seam 有 Local/BYOK/Managed Adapter 与 Deterministic Fake；Interface 仅 capability/schema/policy/context budget；Route 决定在平台 Module。
- **实现任务**：Catalog；用户选择；Route 数据披露；BYOK Key；Managed 无内容日志；用量原子聚合；软/硬限；重试计费；手工降级。
- **测试任务**：各 Route、无网、错误 Key、Schema 非法、Managed 并发超支/换模型/重试、抓包、Gateway 日志、Provider 留存提示。
- **验收证据**：三 Route 录屏、Catalog、抓包、Key/日志扫描、Managed 预算竞态、AI Run、数据外发清单。
- **Codex 验收命令/门**：`pnpm verify:desktop-security`；`pnpm verify:contract`；`pnpm verify:evals:quick`；Managed 预算测试；`pnpm verify:quick`。
- **风险**：无状态 Gateway 的下游 Provider 仍留存；BYOK 误经 Gateway；Local 模型能力不足；成本结算延迟。
- **完成定义**：用户知道内容去向；Local/BYOK/Managed 可分别选；Managed 预算不可绕过；业务事实仍只在本地。

### GLM-M2-04 Vision、Embedding 与本地混合 Search

- **目标**：异步生成可审阅描述与本地 Embedding，并用 FTS5/sqlite-vec 做作用域过滤、融合、解释和关键词降级。
- **范围**：Asset analysis Prompt/Schema；分析版本；文本/视觉向量分空间；Query understanding；FTS/vec/RRF/Rerank；why_recalled；不相关反馈。
- **禁止范围**：非法 Schema 零写入；不把视觉相似等同意图；不把搜索索引搬云；Rerank 不新增候选/放宽 Scope。
- **依赖**：GLM-M2-02、M2-03。
- **修改目录**：`packages/modules/assets/**`、`packages/modules/retrieval/**`、`packages/platform/ai/**` 接线、`apps/desktop/**`、`packages/contracts/**`、`prompts/asset-analysis/**`、`prompts/retrieval-rerank/**`、`evals/**`、`tests/**` 相关。
- **Interface/Seam 要求**：Retrieval Interface 仅 actor/profile/client/project scope、intent、types、limit、latency；本地索引实现隐藏；AI 返回 Draft。
- **实现任务**：分析/Embedding Jobs；版本失效；FTS/vec 候选；RRF；可选 Rerank；解释；P95 降级；反馈。
- **测试任务**：非法输出、模型切换、向量维度、旧索引、删除、私密/异客户、无网、1,000 条、Recall@K/NDCG。
- **验收证据**：Eval、P95、离线 Search、删除反查、Scope 0 泄漏、Schema 零写入、零云抓包。
- **Codex 验收命令/门**：`pnpm verify:local-data`；`pnpm verify:evals:quick`；Search E2E；`pnpm verify:desktop-security`。
- **风险**：本地性能；向量空间混算；解释幻觉；旧 vec 残留。
- **完成定义**：关键词 P95<1s、混合 P95<3s 目标有证据；离线可检索；索引可版本化删除。

## 5. M3：本地 Project 与 Brief

### GLM-M3-01 Client、Project 与文本 Brief

- **目标**：品牌/网页视觉设计师离线创建两个真实项目，保留不可覆盖的 Brief 版本和本地策略。
- **范围**：Client 可选、Project/Design Case、design_domain、Source Document、文本 Brief Revision、项目状态、AI/跨项目/学习策略。
- **禁止范围**：不做多人/通用 PM；不云同步；不覆盖原文；不在本卡做 PDF/Word。
- **依赖**：GLM-M2-04。
- **修改目录**：`packages/modules/projects/**`、`apps/desktop/**`、`packages/contracts/**`、`tests/local-data/**`、`tests/e2e/**`。
- **Interface/Seam 要求**：Projects Module 集中版本/策略；Revision 不可变；子资源只能收紧策略；Renderer 走 IPC。
- **实现任务**：Local Schema/Migration；无 Client 项目；品牌/网页模板；文本导入/重导；策略 UI；审计。
- **测试任务**：重导、并发、旧引用、私密/禁 AI、跨 Client、本地重启、Control Plane 断开。
- **验收证据**：两个真实项目、版本链、策略矩阵、离线录屏、零云抓包。
- **Codex 验收命令/门**：`pnpm verify:local-data`；Project E2E；`pnpm verify:desktop-security`；`pnpm verify:quick`。
- **风险**：项目管理膨胀；策略只在 UI；原文版本可变。
- **完成定义**：项目/Brief/策略本地持久可追溯；无账号/无网可完整使用。

### GLM-M3-02 Requirement Analysis 与判断维度

- **目标**：按用户选择 Route 把 Brief 拆成带引用/认知类型、可编辑拒绝的要求、模糊词、冲突、缺口和判断维度。
- **范围**：Prompt/Schema、Local Job、引用、事实/客户观点/AI 推断/假设、审阅、重分析、手工路径、外发预览。
- **禁止范围**：不把推断写事实；不伪造引用；不覆盖 Brief；AI 不可用时不阻断。
- **依赖**：GLM-M3-01、M2-03。
- **修改目录**：`packages/modules/projects/**`、`apps/desktop/**`、`packages/contracts/**`、`prompts/requirement-analysis/**`、`evals/**`、`tests/**` 相关。
- **Interface/Seam 要求**：Projects Module 接受 Draft；AI Route 不写业务表；引用绑定 Revision；外发内容由 Route Policy 最小化。
- **实现任务**：Schema/Prompt；分析；引用校验；审阅；维度编辑；版本；手工路径；Route 披露。
- **测试任务**：事实/推断、伪引用、注入、AI 断网/预算满、Local/BYOK/Managed、重分析、用户拒绝。
- **验收证据**：真实 Brief 样例、来源覆盖、外发抓包、零写入失败、审阅/离线手工录屏。
- **Codex 验收命令/门**：`pnpm verify:evals:quick`；`pnpm verify:desktop-security`；Requirement E2E；`pnpm verify:quick`。
- **风险**：漂亮废话；BYOK/Managed 数据外发超范围；引用漂移。
- **完成定义**：合法 Route 产生可追溯 Draft；用户可完整手工修正；本地版本不可覆盖。

## 6. M4：证据、命题与决策

### GLM-M4-01 Evidence Board

- **目标**：按判断维度在本地召回并组织正例、反例、边界和未知证据。
- **范围**：Evidence Reference、分组/排序/注释、来源/why_recalled、手工添加、最小 Board UI、本地图关系投影。
- **禁止范围**：不做无限画布；不自动选最佳；不复制 Asset；不隐藏反证/失效来源；不经云端检索个人资料。
- **依赖**：GLM-M2-04、M3-02。
- **修改目录**：`packages/modules/decisions/**`、`packages/modules/retrieval/**` Public Interface、`packages/modules/graph/**`、`apps/desktop/**`、`packages/contracts/**`、`tests/**` 相关。
- **Interface/Seam 要求**：Decisions 只通过 Retrieval Interface 取候选；Evidence 保存本地引用/Scope/认知类型；Graph 为本地派生投影。
- **实现任务**：维度查询；正反/边界；注释/排序；手工路径；来源失效；审计。
- **测试任务**：异客户/私密、被删证据、零结果、重复引用、无 AI、重启、Control Plane 故障。
- **验收证据**：真实项目录屏、正反例、Scope 0 泄漏、删除占位、离线完成。
- **Codex 验收命令/门**：Evidence E2E；`pnpm verify:local-data`；`pnpm verify:desktop-security`；`pnpm verify:quick`。
- **风险**：图片墙退化；Graph 投影漂移；反证被弱化。
- **完成定义**：每条证据本地可追溯；用户无 AI/无网可完成；不合 Scope 内容不出现。

### GLM-M4-02 Proposition、Decision 与 Outcome

- **目标**：本地记录支持/反证、选择/否决、风险、Trade-off、反馈和 Outcome，形成记忆证据链。
- **范围**：Proposition/Decision Revision、状态、解释 Draft、用户保存、Outcome 追加、审计。
- **禁止范围**：AI 不自动保存最终决策/宣称最佳；反馈不覆盖历史；无证据不伪装已验证。
- **依赖**：GLM-M4-01、M2-03。
- **修改目录**：`packages/modules/decisions/**`、`apps/desktop/**`、`packages/contracts/**`、`prompts/design-proposition/**`、`evals/**`、`tests/**` 相关。
- **Interface/Seam 要求**：Decisions 集中版本/状态；AI 只产 Draft；引用绑定本地 Revision；Renderer 走用例 IPC。
- **实现任务**：Schema/Migration；命题；选择/拒绝；Trade-off；Decision；反馈/Outcome；解释。
- **测试任务**：AI 自动写拦截、并发、旧引用、反馈追加、撤销草稿、预算满/离线手工。
- **验收证据**：真实决策链、版本图、自动写拦截、Outcome 录屏、零云事实抓包。
- **Codex 验收命令/门**：Decision E2E；`pnpm verify:evals:quick`；`pnpm verify:local-data`；`pnpm verify:quick`。
- **风险**：只留最终结果；Draft/最终混淆；历史被覆盖。
- **完成定义**：最终决策只由用户保存；选择、放弃、代价、结果均本地可追溯。

## 7. M5：本地记忆、召回与删除

### GLM-M5-01 Memory Policy 与候选

- **目标**：从本地决策生成候选；重要长期记忆必须由用户确认。
- **范围**：Candidate、类型、Evidence、Scope、Policy、确认/编辑/拒绝、do_not_learn、来源、去重。
- **禁止范围**：AI 不写 Active Memory；不把客户偏好当个人；不建隐藏人格/审美评分；不上传记忆到 Control Plane。
- **依赖**：GLM-M4-02。
- **修改目录**：`packages/modules/memory/**`、`packages/modules/graph/**`、`apps/desktop/**`、`packages/contracts/**`、`prompts/memory-extraction/**`、`evals/**`、`tests/**` 相关。
- **Interface/Seam 要求**：Memory Interface 为 propose/review/status；Policy 单点；Candidate/Active 分离；AI 只返回 Draft。
- **实现任务**：Local Schema；Policy；Scope；审阅；证据；去重；审计；无 AI 手工候选。
- **测试任务**：自动确认、客户/个人混淆、无证据、重复、策略收紧、并发确认/删除、零云抓包。
- **验收证据**：审阅录屏、零自动确认、Policy Fixture、来源/Scope、Control Plane 表/网络扫描。
- **Codex 验收命令/门**：Memory E2E；`pnpm verify:evals:quick`；`pnpm verify:local-data`；`pnpm verify:desktop-security`。
- **风险**：错误记忆；Policy 散落；Candidate/Active 混写。
- **完成定义**：每条 Active Memory 有用户动作、来源、Scope；全部事实只在本地。

### GLM-M5-02 跨项目 Recall、冲突与衰减

- **目标**：Project B 本地合法召回 Project A 已确认 Memory，并显示来源、范围、冲突和理由。
- **范围**：Eligibility、Scope、衰减、冲突、调用记录、不适用反馈、Context Pack。
- **禁止范围**：不跨客户；不静默覆盖；不把未确认候选进 Context；不将不适用自动删除。
- **依赖**：GLM-M5-01、M3-01、M2-04。
- **修改目录**：`packages/modules/memory/**`、`packages/modules/retrieval/**`、`packages/modules/graph/**`、`apps/desktop/**`、`packages/contracts/**`、`tests/**` 相关。
- **Interface/Seam 要求**：Recall Interface 接受本地 Profile/Client/Project/Purpose；调用者不能直查表绕过 Eligibility。
- **实现任务**：过滤；衰减；冲突并列；调用；入口；反馈；最小 Context Pack。
- **测试任务**：同/异客户、私密、禁跨项目、challenged/deleted、时间、第二项目、AI Route 外发最小化。
- **验收证据**：两项目录屏、Recall reason、调用记录、0 泄漏、Context 抓包。
- **Codex 验收命令/门**：Recall E2E；`pnpm verify:evals:quick`；`pnpm verify:desktop-security`；`pnpm verify:quick`。
- **风险**：过滤后置；回音壁；Managed Route 多发上下文。
- **完成定义**：Project B 离线可召回；AI 解释可选；任何外发只含批准 Context。

### GLM-M5-03 本地软删除、Purge 与证书

- **目标**：7 天可恢复；永久删除立即撤销本地使用；设备可执行时 30 天内清理 App 管理本地面并生成边界清晰的证书。
- **范围**：Asset/Project/Memory 影响预览、Tombstone、恢复、FTS/vec/Graph/Job/Cache/Object/Temp/Export 清理、引用占位、Proof、Pending Device 状态。
- **禁止范围**：不把设备离线标完成；不证明 OS 备份/用户副本/Provider 留存；证书不含正文/向量；不只删主行。
- **依赖**：GLM-M5-02、M2-01、M2-04、M4-02。
- **修改目录**：`packages/modules/assets/**`、`projects/**`、`decisions/**`、`memory/**`、`graph/**`、`retrieval/**`、`packages/platform/local-*`、`apps/desktop/**`、`packages/contracts/**`、`tests/deletion/**`。
- **Interface/Seam 要求**：各 Module 暴露 request-delete/restore/status；Purge Orchestrator 维护 Surface Manifest；Suppress 先于物理清理；Proof 明确 included/excluded/pending。
- **实现任务**：7 天恢复；永久二次确认；立即 Suppress；幂等 Purge；Deadline；Pending；引用占位；本地证书；Provider/备份排除说明。
- **测试任务**：立即搜索/Recall/Context、恢复、重复/部分失败、旧 Job、App 退出 31 天、再启动清理、全层反查、证书边界。
- **验收证据**：Surface Manifest、全层反查、Pending→Completed 录屏、证书样例、时间模拟、排除项。
- **Codex 验收命令/门**：`pnpm verify:local-data`；删除 E2E；`pnpm verify:e2e:p0a`；`pnpm verify:desktop-security`。
- **风险**：离线 SLA 误承诺；临时/导出/WAL 漏删；Provider 留存被错误背书。
- **完成定义**：提交后立即零本地召回；离线诚实 Pending；仅全部 App 管理面验证后签发 Completed。

## 8. GATE-P0A

只有以下全部成立，Codex 才下发 M6：

1. 同一品牌/网页视觉设计师用两个真实项目完成 Link/Viewport → Asset → Search → Brief → Evidence → Decision → Memory → Recall。
2. 无账号、断网、Control Plane/Managed Gateway 停止时，本地核心与手工路径仍可用。
3. Local/BYOK/Managed Route 数据去向明确；Managed `$20` 不可绕过。
4. 永久删除后立即零搜索/Recall/Context；设备离线显示 Pending，不假签完成。
5. `verify:e2e:p0a/local-data/desktop-security/bridge/contract/evals:quick` 全绿。

## 9. M6：P0-B 完整 MVP

### GLM-M6-01 Extension 全页采集

- **目标**：本地捕获完整网页，失败保留 Link/Viewport/原因。
- **范围**：分段、拼接、固定元素、进度/取消、内存/长度上限、Bridge 同步。
- **禁止范围**：不云渲染；不无限滚动；不回滚已成功 Artifact。
- **依赖**：GATE-P0A。
- **修改目录**：`apps/browser-extension/**`、`tests/bridge/**`、`tests/e2e/**`、`tests/fixtures/**`。
- **Interface/Seam 要求**：沿用 Capture Contract；算法为 Extension 内部。
- **实现任务**：滚动捕获/拼接；限制；取消/重试；Fallback。
- **测试任务**：固定头、懒加载、超长、滚动容器、内存、Desktop 离线队列。
- **验收证据**：页面矩阵、耗时/内存、失败降级、零云抓包。
- **Codex 验收命令/门**：`pnpm verify:bridge`；Full Page E2E；`pnpm verify:quick`。
- **风险**：内存崩溃、固定元素重复、浏览器差异。
- **完成定义**：受支持页面成功；失败明确且其他内容不丢。

### GLM-M6-02 Extension 框选局部

- **目标**：保存选区截图、坐标、来源和关注原因到本地。
- **范围**：Overlay、DPR/滚动坐标、预览、取消/重选、离线队列。
- **禁止范围**：不采集选区外正文；不注入永久样式；不等同用户后续 Fragment。
- **依赖**：GLM-M6-01。
- **修改目录**：`apps/browser-extension/**`、`tests/e2e/**`、`tests/fixtures/**`。
- **Interface/Seam 要求**：Region Artifact 走统一 Contract；坐标转换内部化。
- **实现任务**：选择层、坐标、裁切、降级。
- **测试任务**：DPR、缩放、滚动、iframe、固定层、Esc、Desktop 离线。
- **验收证据**：坐标 Fixture、录屏、选区/来源对照。
- **Codex 验收命令/门**：Region E2E；`pnpm verify:bridge`；`pnpm verify:quick`。
- **风险**：坐标漂移、页面污染、iframe 权限。
- **完成定义**：选区可复现；失败不丢 Link/原因。

### GLM-M6-03 Extension 页面单图

- **目标**：选择单图并保留页面/图像来源到本地。
- **范围**：src/srcset/currentSrc、CSS background/canvas 降级、MIME/尺寸、CORS。
- **禁止范围**：不绕访问控制；不宣称授权；不抓全页图片。
- **依赖**：GLM-M6-02。
- **修改目录**：`apps/browser-extension/**`、`tests/e2e/**`、`tests/fixtures/**`。
- **Interface/Seam 要求**：Image Artifact 走 Capture Contract；DOM 解析内部化。
- **实现任务**：选择、URL 解析、截图降级、来源 unknown。
- **测试任务**：srcset/data/CSS/canvas/CORS/懒加载/失效。
- **验收证据**：类型矩阵、来源、降级、零云抓包。
- **Codex 验收命令/门**：Image E2E；`pnpm verify:bridge`；`pnpm verify:quick`。
- **风险**：CORS、来源丢失、版权误解。
- **完成定义**：单图或明确降级本地保存；来源透明。

### GLM-M6-04 本地 Import Batch 与配额

- **目标**：本地导入文件/图片/文档/链接/书签，原子执行 500/批、1 active+1 queued、2,000/日。
- **范围**：Batch/Item、部分成功、单项重试/取消、队列、公平、进度、时区口径配置。
- **禁止范围**：不做专用连接器；不 UI 单独限额；不云上传；不回滚成功项。
- **依赖**：GATE-P0A、M2-01。
- **修改目录**：`packages/modules/assets/**`、`packages/platform/local-jobs/**`、`apps/desktop/**`、`packages/contracts/**`、`tests/import/**`。
- **Interface/Seam 要求**：Batch Interface；配额在 LocalStore 事务中；Item 复用 Asset Pipeline。
- **实现任务**：解析、状态、原子配额、调度、部分失败、删除 Batch。
- **测试任务**：501、第三批、2,001、并发、日界线、取消、重启、磁盘满。
- **验收证据**：并发报告、2,000 压测、状态 UI、零云抓包。
- **Codex 验收命令/门**：`pnpm verify:local-data`；Import E2E；容量测试。
- **风险**：计数竞态、磁盘爆满、交互任务饥饿。
- **完成定义**：配额不可绕过；成功项保留；全部本地处理。

### GLM-M6-05 Fragment 与本地视觉相似

- **目标**：裁切 Fragment，确认后用本地独立视觉向量检索。
- **范围**：坐标/父 Asset/关注点、Vision 候选、确认/拒绝、视觉 vec、cropped_from、删除传播。
- **禁止范围**：不自动确认；不混算向量空间；不云向量库。
- **依赖**：GATE-P0A、M2-04。
- **修改目录**：`packages/modules/assets/**`、`retrieval/**`、`graph/**`、`apps/desktop/**`、`evals/**`、`tests/**` 相关。
- **Interface/Seam 要求**：Fragment 归 Assets；Retrieval 只见公开单元；视觉空间独立版本。
- **实现任务**：裁切、确认、vec、相似、父链、删除。
- **测试任务**：坐标、父变更/删除、未确认、空间混用、Recall。
- **验收证据**：录屏、父链、Eval、全层删除。
- **Codex 验收命令/门**：`pnpm verify:local-data`；`pnpm verify:evals:quick`；Fragment E2E。
- **风险**：坐标失效、相似误称适用、派生漏删。
- **完成定义**：确认 Fragment 本地可检索/引用；删除无残留。

### GLM-M6-06 Project Review

- **目标**：基于本地证据生成有来源复盘 Draft，确认后才进 Memory Candidate。
- **范围**：变化、方向、否决、反馈、有效/失效、可迁移/项目限定、Revision。
- **禁止范围**：不编造；不直写长期记忆；不覆盖旧复盘。
- **依赖**：GATE-P0A、M4-02、M5-01。
- **修改目录**：`packages/modules/decisions/**`、`memory/**` Public Interface、`apps/desktop/**`、`prompts/project-review/**`、`evals/**`、`tests/**`。
- **Interface/Seam 要求**：Review 属 Decisions；AI 消费最小 Evidence Pack；确认经 Memory Interface。
- **实现任务**：Schema/Prompt、来源、版本、审阅、候选回写。
- **测试任务**：缺 Outcome、矛盾、伪造、重开、三 Route/无 AI、拒绝。
- **验收证据**：真实复盘、来源覆盖、外发抓包、版本链。
- **Codex 验收命令/门**：`pnpm verify:evals:quick`；Review E2E；`pnpm verify:desktop-security`。
- **风险**：总结腔、客户语义外溢、复盘/记忆混写。
- **完成定义**：关键结论可追溯；确认前长期记忆零写入。

### GLM-M6-07 Personal Dictionary

- **目标**：本地记录同一模糊词在个人/客户/项目的已确认不同含义与案例。
- **范围**：Term/Sense、Scope、Evidence、版本/冲突、确认/停用、需求/召回引用。
- **禁止范围**：个人含义不覆盖更具体 Scope；不自动建正式 Sense；不云同步。
- **依赖**：GATE-P0A、M6-06。
- **修改目录**：`packages/modules/memory/**`、`projects/**`/`retrieval/**` Public Interface、`graph/**`、`apps/desktop/**`、`tests/**`。
- **Interface/Seam 要求**：Dictionary 为 Memory 内深模块；只返回 Scope 解析后 Sense。
- **实现任务**：Term/Sense、优先级、审阅、冲突、引用、删除。
- **测试任务**：同词多 Scope、冲突、无证据、来源删除、离线。
- **验收证据**：词义对照、Scope、引用、删除传播。
- **Codex 验收命令/门**：Dictionary E2E；`pnpm verify:local-data`；`pnpm verify:quick`。
- **风险**：静态标签化、Scope 错、过期来源。
- **完成定义**：最具体合法 Sense 生效并显示来源；全本地。

### GLM-M6-08 Reverse Memory

- **目标**：用本地反证、失败、重复路径和未尝试邻近方案挑战旧偏好。
- **范围**：Counter Evidence、Path Signal、阈值、提醒、确认/忽略/关闭、影响记录。
- **禁止范围**：不审美评分；不凭一次行为；不强制打断；不无证据“你总是”。
- **依赖**：GATE-P0A、M5-02、M6-06/07。
- **修改目录**：`packages/modules/memory/**`、`retrieval/**`、`graph/**`、`apps/desktop/**`、`prompts/memory-consolidation/**`、`evals/**`、`tests/**`。
- **Interface/Seam 要求**：走 Memory Policy；Signal 不改 Active Memory；关闭在 Module 内执行。
- **实现任务**：规则、反证召回、UI、控制、反馈、删除传播。
- **测试任务**：证据不足、跨客户、来源删、关闭、频率、模型夸大。
- **验收证据**：多项目、阈值、关闭后零提醒、无评分扫描。
- **Codex 验收命令/门**：`pnpm verify:evals:quick`；Reverse E2E；`pnpm verify:local-data`。
- **风险**：冒犯、相关当因果、提醒疲劳。
- **完成定义**：提醒有合法多证据、可关闭、不改变原记忆。

## 10. M7：质量与发布

### GLM-M7-01 Evals 与安全红队

- **目标**：建立 Local-first、IPC/Bridge、AI 外发、Scope、记忆、删除的阻断式回归。
- **范围**：Core/Holdout/攻击集、确定性/模型/人工评分、Prompt Injection、恶意网页、数据外发、模型差异、错误池。
- **禁止范围**：不提交客户正文；不只评文风；安全硬门不平均；PR 不依赖真实网络。
- **依赖**：M6 全部 PASS。
- **修改目录**：`evals/**`、`tests/security/**`、`tests/desktop-security/**`、`tests/bridge/**`、`scripts/**`、`.github/**`、`prompts/**` 新版本。
- **Interface/Seam 要求**：通过公开 Contract/Interface；绑定 Prompt/Schema/Route/Policy/Dataset 版本。
- **实现任务**：品牌/网页集、攻击集、评分、PR/Nightly/Release、差异、错误回流。
- **测试任务**：XSS/IPC/Bridge 重放、越 Scope、无来源、自动记忆、外发过量、成本>15%。
- **验收证据**：数据卡、红队、差异、失败阻断、去标识审查。
- **Codex 验收命令/门**：`pnpm verify:evals:quick`；全部安全门；Nightly/Release Eval。
- **风险**：理想 Fixture、模型评模型、隐私样本泄漏。
- **完成定义**：关键退化阻断合并/Route 晋级；报告可复现。

### GLM-M7-02 可观测、容量、成本与更新

- **目标**：证明双平台本地容量、任务恢复、Managed 预算、删除 Pending 和安全更新可运营。
- **范围**：本地脱敏诊断、可选聚合遥测；1,000 Asset/2,000 Import；队列/磁盘/vec；Managed 成本；删除 Deadline；签名更新/回滚。
- **禁止范围**：不上传正文/路径/搜索词；不靠云端才能诊断；不以拆微服务解决本地瓶颈。
- **依赖**：GLM-M7-01、M5-03、M6-04。
- **修改目录**：`packages/platform/observability/**`、`local-jobs/**`、`ai/**`、`apps/desktop/**`、`infra/**`、`scripts/**`、`tests/performance/**`。
- **Interface/Seam 要求**：诊断先本地；遥测 Adapter 可关闭；预算仍由 AI Platform Module；更新不触碰业务 Schema 未迁移版本。
- **实现任务**：指标/诊断导出、压测、磁盘预警、Managed 成本、Pending 删除提醒、签名更新/回滚。
- **测试任务**：磁盘满、休眠、DB 锁、Provider 故障、预算并发、更新中断、离线回滚、遥测抓包。
- **验收证据**：压测、诊断包、抓包、成本模拟、更新/回滚录屏、Runbook。
- **Codex 验收命令/门**：性能脚本；`pnpm verify:desktop-security`；`pnpm verify:release` 子门。
- **风险**：诊断泄漏路径/正文；更新破坏 DB；预算结算漂移。
- **完成定义**：关键故障本地可定位；预算不可绕；双平台安全更新可回滚。

### GLM-M7-03 Onboarding、双平台打包与 MVP Release

- **目标**：目标设计师可独立完成完整 Local-first MVP，产出 Go/No-Go 包。
- **范围**：Onboarding、无账号/跳过、数据位置/AI Route/备份/删除说明、五采集、完整 E2E、Extension/Native Host 安装、签名/公证、SBOM。
- **禁止范围**：不做公开大规模发布、付费、团队、Figma；不重做全局视觉；不以文案掩盖缺失。
- **依赖**：GLM-M7-02；全部前卡 PASS。
- **修改目录**：`apps/desktop/**`、`apps/browser-extension/**`、`apps/native-host/**`、`tests/e2e/**`、`scripts/**`、`.github/**`、`infra/**`、`README.md`、`docs/api/**`。
- **Interface/Seam 要求**：Onboarding 编排现有 Interface；E2E 不绕真实 Key/Bridge/LocalStore；升级兼容上一数据版本和 Extension Contract。
- **实现任务**：引导/反馈、安装器、权限披露、AI Route 选择、数据/备份/删除说明、完整 E2E、发布/回滚包。
- **测试任务**：macOS/Windows 全新/升级、无网/无账号、五采集、导入、Fragment、两个项目、记忆、复盘、词典、反向、删除 Pending/Completed。
- **验收证据**：双平台录屏/包、E2E、Extension/Host、SBOM、签名、公证、迁移/回滚、Go/No-Go 索引。
- **Codex 验收命令/门**：`pnpm verify:e2e:p0a`；`pnpm verify:e2e:p0b`；`pnpm verify:release`；人工 Release Checklist。
- **风险**：原生模块平台差异；Extension 安装复杂；示例掩盖真实失败。
- **完成定义**：P0 缺陷 0；双平台安装/升级/回滚可复现；封测可启动。

## 11. 统一回传

GLM 每卡必须按协议交付基线/交付 SHA、差异、Interface/Seam、Migration、IPC/Bridge/Key、AI 外发、完整测试、双平台证据、风险与偏差。只有一句“已完成”视为未交付。
