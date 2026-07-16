# Codex ↔ GLM 5.2 开发交接协议

版本：v2.1
状态：Local-first 已确认执行基线

## 1. 分工

### Codex

- 负责需求理解、任务拆解、Interface/Seam 判定、开发验收和测试结论。
- 每次向 GLM 下发一个阶段包；阶段内按任务卡依赖顺序实现，上一阶段未 `PASS`，不得开始下一阶段。
- 审查差异、迁移、测试、可视证据、安全、成本和删除证明。
- 发现 PRD、架构和实现冲突时，先判定任务修订、ADR 或需求变更。

### GLM 5.2

- 负责 Monorepo、Electron、Extension、Native Host、本地存储、AI、全部业务代码、测试和打包。
- 只修改当前任务卡 Allowlist 内目录；偏差必须先报 Codex。
- 通过模块 Public Interface 实现；测试观察 Interface，不穿透内部私有实现。
- 交付基线 SHA、交付 SHA、完整测试、截图/录屏、迁移与风险。

### 禁止

- GLM 不得修改 `docs/product/**`、`docs/architecture/**`、`docs/adr/**`、`docs/delivery/**`。
- GLM 不得擅改技术栈、顶层目录、Local-first 原则、IPC/Bridge 安全模型、删除语义或 AI Route 分类。
- GLM 不得把任何云数据库或云对象存储做成 Asset、Project、Decision、Memory、Graph、Job、Embedding 的事实源或默认副本。
- GLM 不得把用户内容同步到 Control Plane；不得用云端在线状态阻塞本地核心流程。
- GLM 不得在 Renderer/Extension 暴露 Node 能力、数据库句柄、文件系统、主密钥或 Provider Key。
- Codex 不写业务代码；验收发现实现缺口后退回 GLM 修复。

## 2. Local-first 硬基线

| 领域 | 唯一执行口径 |
|---|---|
| 主应用 | Electron Desktop，macOS + Windows；Renderer 不直接访问系统资源 |
| 业务事实源 | 本地加密 SQLite；素材、项目、判断、决策、记忆、图关系、Job、审计均在本地 |
| 全文检索 | SQLite FTS5，本地构建与删除 |
| 向量检索 | sqlite-vec；若 Spike 无法满足打包/删除/双平台要求，先提交替代 ADR，不得静默换库 |
| 文件 | LocalObjectStore 管理应用私有目录；对象加密、原子写入、孤儿回收 |
| 扩展链路 | Chrome MV3 → Native Messaging Host → 安全 Loopback Local Bridge → Desktop；Desktop 不在线时 Extension 本地排队 |
| 云端 | Supabase 仅为可选 Control Plane：账号、设备、Entitlement、配置/Model Catalog、Managed AI 用量聚合；不存用户业务内容 |
| AI Route | `local` 本地模型 Adapter；`byok-direct` 用户本机直连 Provider；`managed-stateless` 通过无内容持久化的托管 Gateway |
| AI 预算 | `$15` 软提醒、`$20` 硬上限只约束 `managed-stateless`；Local/BYOK 不计入平台补贴预算，但展示本地资源或 Provider 自付说明 |
| 封测人群 | 品牌设计师、网页视觉设计师 |
| 产品名 | 暂不冻结；代码不得依赖最终品牌名 |
| 导入 | 500 文件/批；1 active + 1 queued；2,000/日；本地事务原子计数 |
| 删除 | 7 天可恢复；永久删除立即在本地撤销查询/召回/AI Context，App 可执行时 30 天内清理应用管理本地面并生成证书 |

## 3. 删除证明边界

删除证书只证明应用实际控制并检查过的本地面：

- 加密 SQLite 业务行、FTS5、sqlite-vec、Graph/派生表、Job/缓存。
- LocalObjectStore 原件、预览、临时文件和应用管理导出副本。
- 应用进程可访问且登记在删除清单中的本地派生物。

必须显式排除：

- macOS Time Machine、Windows File History、磁盘镜像、企业备份和用户自行复制的导出文件。
- Local/BYOK/Managed Provider 自身的请求日志、训练或留存；按各 Provider 政策处理。
- App 未运行、设备离线、磁盘不可访问时尚未执行的清理。此时状态必须为 `pending_device_execution`，不得签发 `completed`。
- 可选 Control Plane 的账号/Entitlement/聚合用量删除是另一张证书，不得冒充本地业务内容证书。

30 天 SLA 仅对 App 获得执行机会、磁盘可访问的应用管理本地面成立；设备持续离线时显示 Pending、最后尝试时间和恢复执行方法。

## 4. 阶段门禁协议

```text
STAGE PLANNED → READY → IN DEVELOPMENT → STAGE ACCEPTANCE → PASS
                         ↘ PARTIAL HANDOFF        ↘ REJECT → IN DEVELOPMENT
```

1. Codex 下发当前阶段、所含任务卡、允许目录、依赖 PASS 证据和基线 SHA。
2. GLM 在阶段内按依赖顺序开发；每卡独立 Commit、测试日志和交付记录，但无需等待 Codex 逐卡验收。
3. 每卡完成后 GLM 自行运行 `verify:quick` 与专项门；失败不得开始依赖它的下一卡。
4. 阶段全部完成后进入统一验收；Codex 复跑阶段矩阵并只给一次正式结论。
5. `M0-01` 与 `M0-02` 分别涉及可运行骨架和持久化技术决策，保留单卡硬门；从 `M0-03` 起按 3–5 卡组包。
6. H0 安全、内容外发、密钥、删除、迁移、预算问题只允许 `PASS/REJECT`。
7. `CONDITIONAL PASS` 只适用于非阻塞展示/观测补项，并登记截止阶段。

### 4.1 立即停工与 Partial Handoff

以下问题不能等到阶段末才暴露：

- Spike 失败或需要更换已冻结技术路线；
- 数据丢失、Migration 不可恢复、密钥/内容明文、未经授权的云外发；
- Renderer/Extension 越权、通用 IPC、Bridge 可伪造/重放、删除假完成；
- macOS/Windows 任一目标平台不能安装、启动或运行关键原生能力；
- 需要修改任务 Allowlist 外目录或产品/架构/ADR/交付基线；
- 上一任务卡硬门无法真实通过，只能跳过或伪造测试。

触发时 GLM 必须停在最后一个可复现 Commit，提交触发事实、失败日志、受影响卡、候选方案和回滚点。Codex 先做方向判断，再决定修复、拆阶段或进入 ADR。

## 5. 变更申请

```text
RFC 编号：RFC-<task-id>-<seq>
触发事实：
与基线冲突：
候选 A / B：
Interface/Seam 影响：
本地数据与迁移影响：
IPC/Bridge/密钥影响：
AI 外发、成本、删除影响：
推荐方案：
```

遇到 sqlite-vec/加密 SQLite 双平台打包失败、Native Messaging 限制、Electron 安全限制或 Provider 不支持无状态处理时，GLM 必须以 Spike 证据和 ADR 候选返回，不能自行把事实源搬云。

## 6. GLM 交付模板

```text
阶段 / 所含任务卡 / 基线 SHA / 各卡 Commit / 交付 SHA
1. 实现摘要
2. 修改文件与理由
3. Interface/Seam 变化
4. SQLite/Object/Vector Migration 与回滚
5. IPC/Bridge/Key/外发数据审查
6. 测试命令、退出码与完整结果
7. macOS/Windows 打包或 E2E 证据
8. UI 录屏/截图
9. 性能、成本、删除证据
10. 风险、未完成项、与任务卡偏差
```

## 7. 固定验收命令

由 `GLM-M0-01` 建立入口，`GLM-M0-02` 变为真实门：

| 命令 | 门禁 |
|---|---|
| `pnpm verify:quick` | Format、Lint、Typecheck、依赖方向、单测、构建烟测 |
| `pnpm verify:local-data` | 加密 SQLite、Migration、FTS5、sqlite-vec、ObjectStore、删除 |
| `pnpm verify:desktop-security` | Electron CSP、IPC、Preload、Key、导航、日志/Bundle Secret |
| `pnpm verify:bridge` | Native Host、Loopback 认证、重放/来源/端口、Extension 离线队列 |
| `pnpm verify:contract` | Renderer/Main/Worker/Extension/Host/AI Route Wire Contract |
| `pnpm verify:evals:quick` | AI Schema、来源、Scope、Route、冻结样本与外发最小化 |
| `pnpm verify:e2e:p0a` | 两个真实项目 Local-first 纵向首验 |
| `pnpm verify:e2e:p0b` | 五采集、导入、Fragment、复盘、词典、反向记忆 |
| `pnpm verify:release` | 双平台包、全部门、容量、删除、签名/更新与发布清单 |

## 8. 直接 No-Go

- 任何用户业务内容未经明确当前动作进入 Control Plane 或云端事实库。
- Desktop 退出/断网后核心资产、项目、记忆不可用。
- Renderer/Extension 获得数据库、文件系统、主密钥或任意 IPC 能力。
- Loopback Bridge 可被任意网页/本机进程无认证调用，或 Token 可重放。
- 永久删除后仍可被本地搜索、召回或进入 AI Context。
- 离线设备被错误标记“已完成删除”。
- Managed Route 通过并发、重试、换模型绕过 `$20`；或将预算错误套到 Local/BYOK。
- sqlite-vec/加密数据库双平台失败后擅自改为云端主存储。
