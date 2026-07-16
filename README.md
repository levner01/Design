# DesignWan

DesignWan 是当前仓库工作名（原始方向名 `Design Cognition`）：一个会持续学习设计师本人，把灵感素材、甲方需求、设计方法、历史作品、项目经验与设计判断沉淀为长期能力的个人设计认知工作台。

当前仓库处于产品与技术基线阶段。本阶段的目标是锁定 MVP、领域语言、数据与 AI 边界、开发任务和里程碑；尚未开始功能开发。

## 结论先行

- 日常高频入口：浏览器插件收藏素材。
- 核心价值入口：从甲方需求出发，召回个人素材与经验，形成有证据的设计判断。
- 首批封测用户：品牌设计师与网页视觉设计师；UI/UX 仍由领域模型兼容，但不平均分散首批验证资源。
- 推荐语言：TypeScript 全栈；Electron + React 桌面端为主产品，浏览器插件为采集伴侣。
- Local-first：SQLite + FTS5、Encrypted Asset Vault 与 LocalVectorIndex 是业务事实源；素材、项目、记忆、图谱和向量不进入云端。
- Supabase 仅作为可选 Control Plane，保存账号、订阅、模型目录和 Managed AI 用量，不保存业务内容或原始 Prompt。
- AI 路由：Local Model、BYOK Direct Cloud、Managed Stateless Cloud；任何云 AI 均需逐项目授权。
- 不做：AI 替设计师评判审美、自动生成“最佳方案”、把推断偷偷写成长期记忆、MVP 上 Neo4j 或微服务。

## 文档入口

- [完整 PRD](docs/product/PRD.md)
- [产品理解与风险校准](docs/product/PRODUCT_BASELINE.md)
- [MVP 用户与业务流程](docs/product/MVP_USER_FLOWS.md)
- [产品术语表](docs/product/GLOSSARY.md)
- [技术栈与架构](docs/architecture/STACK_AND_ARCHITECTURE.md)
- [领域模型](docs/architecture/DOMAIN_MODEL.md)
- [数据模型](docs/architecture/DATA_MODEL.md)
- [记忆系统](docs/architecture/MEMORY_SYSTEM.md)
- [知识图谱本体](docs/architecture/KNOWLEDGE_GRAPH.md)
- [AI 契约与评测](docs/architecture/AI_CONTRACTS_AND_EVALS.md)
- [Epic 与 Story](docs/delivery/EPICS_AND_STORIES.md)
- [开发里程碑](docs/delivery/MILESTONES.md)
- [MVP 发布检查清单](docs/delivery/MVP_RELEASE_CHECKLIST.md)
- [GLM 5.2 实施任务卡](docs/delivery/GLM_IMPLEMENTATION_TASKS.md)
- [Codex 验收矩阵](docs/delivery/CODEX_ACCEPTANCE_MATRIX.md)
- [Codex ↔ GLM 交接协议](docs/delivery/HANDOFF_PROTOCOL.md)
- [全部文档索引](docs/README.md)

## 决策状态

产品定位、Local-first、本地桌面主产品、浏览器插件必做、首批封测领域、记忆候选确认机制和 Codex/GLM 分工已经锁定。正式产品名仍未决定；AI 具体模型由受评测目录动态维护并由用户选择。

## 开发说明（GLM-M0-01 骨架）

本节由 GLM-M0-01 任务卡建立，描述如何在全新环境启动 Monorepo / Electron 骨架。

### 前置要求

- Node.js 24 LTS（本地开发可在 Node 22 临时运行，但生产构建要求 24）
- Corepack（Node 24 内置）
- pnpm 11（通过 `corepack enable` 自动启用）
- macOS 12+ 或 Windows 10+

### 全新环境启动步骤

```bash
# 1. 启用 Corepack
corepack enable

# 2. 安装依赖（frozen lockfile）
corepack pnpm install --frozen-lockfile

# 3. TypeScript Project References 构建
corepack pnpm exec tsc -b

# 4. 全量构建（Turbo）
corepack pnpm build

# 5. 快速验证
corepack pnpm verify:quick

# 6. 启动 Desktop 安全空壳（仅显示协议版本）
corepack pnpm --filter @designwan/desktop start

# 7. 打包烟测（macOS arm64 / Windows x64）
corepack pnpm --filter @designwan/desktop package:mac
corepack pnpm --filter @designwan/desktop package:win
```

### 九个固定验收门

| 命令                           | 当前状态                     | 负责任务                  |
| ------------------------------ | ---------------------------- | ------------------------- |
| `pnpm verify:quick`            | 真实通过                     | GLM-M0-01                 |
| `pnpm verify:local-data`       | 故意失败（exit 1）           | GLM-M0-02 / M0-03         |
| `pnpm verify:desktop-security` | 静态子集通过；运行时门未实现 | GLM-M0-04                 |
| `pnpm verify:bridge`           | 故意失败（exit 1）           | GLM-M1-01 / M1-02         |
| `pnpm verify:contract`         | 静态子集通过；运行时门未实现 | GLM-M0-04 / M1-03 / M2-03 |
| `pnpm verify:evals:quick`      | 故意失败（exit 1）           | GLM-M2-04 / M7-01         |
| `pnpm verify:e2e:p0a`          | 故意失败（exit 1）           | GATE-P0A                  |
| `pnpm verify:e2e:p0b`          | 故意失败（exit 1）           | GLM-M6 系列               |
| `pnpm verify:release`          | 故意失败（exit 1）           | GLM-M7-02 / M7-03         |

未实现的门必须以非零退出码失败，禁止用永远返回成功的假脚本伪装通过。

### Monorepo 结构

详见 [docs/architecture/STACK_AND_ARCHITECTURE.md §13](docs/architecture/STACK_AND_ARCHITECTURE.md)。
本卡仅建立顶层骨架：

- `apps/desktop`（main / preload / renderer 安全空壳）
- `apps/browser-extension`（MV3 manifest 可解析）
- `apps/native-host`（stdio 骨架）
- `apps/managed-gateway`（空骨架，不接收业务内容）
- `packages/contracts` / `modules` / `platform` / `testing` / `ui`
- `tests/` / `evals/` / `prompts/` / `scripts/` / `infra/` / `.github/workflows/`

### 依赖方向（禁止穿透）

业务 Module 不 Import Electron、SQLite Driver、sqlite-vec、Provider SDK、HTTP Server 或 Chrome Extension 类型。
Renderer 只能通过 Preload 暴露的窄 Interface 调用 Main；不得出现通用 `invoke(channel, args)`、任意 fs/db/shell 能力。
Managed Gateway 不得反向依赖业务模块。

依赖方向规则定义在 [scripts/deps-rules.mjs](scripts/deps-rules.mjs)，由 [scripts/check-deps.mjs](scripts/check-deps.mjs) 在 `pnpm verify:quick` 中强制执行。
