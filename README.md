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
