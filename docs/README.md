# DesignWan 项目基线索引

本目录承载进入业务开发前的产品、领域、技术、AI、数据与交付基线。若文档与实现冲突，应先形成 ADR 或更新基线，不允许靠隐性约定继续开发。

## 建议阅读顺序

1. [产品理解与风险校准](product/PRODUCT_BASELINE.md)
2. [完整 PRD](product/PRD.md)
3. [MVP 用户与业务流程](product/MVP_USER_FLOWS.md)
4. [产品术语表](product/GLOSSARY.md)
5. [技术栈与系统架构](architecture/STACK_AND_ARCHITECTURE.md)
6. [领域模型](architecture/DOMAIN_MODEL.md)
7. [数据模型](architecture/DATA_MODEL.md)
8. [个人记忆系统](architecture/MEMORY_SYSTEM.md)
9. [知识图谱本体](architecture/KNOWLEDGE_GRAPH.md)
10. [AI 契约与 Evals](architecture/AI_CONTRACTS_AND_EVALS.md)
11. [Epic 与开发任务](delivery/EPICS_AND_STORIES.md)
12. [Codex ↔ GLM 交接协议](delivery/HANDOFF_PROTOCOL.md)
13. [GLM 5.2 实施任务卡](delivery/GLM_IMPLEMENTATION_TASKS.md)
14. [Codex 验收矩阵](delivery/CODEX_ACCEPTANCE_MATRIX.md)
15. [里程碑](delivery/MILESTONES.md)
16. [MVP 发布检查清单](delivery/MVP_RELEASE_CHECKLIST.md)

## 基线决策摘要

- 全栈语言：TypeScript；Python 仅作为未来有明确证据的离线研究 Adapter，不作为 MVP 第二主语言。
- 架构：Monorepo + 模块化单体；Electron Desktop 是主产品，Extension、Native Host、Local Worker 是本地部署形态。
- 数据：SQLite + FTS5、Encrypted Asset Vault、LocalVectorIndex；业务内容、图谱、向量与记忆不进入云端，MVP 不引入 Neo4j。
- 控制面：Supabase 可选且仅承载账号、订阅、签名模型目录和 Managed AI 用量元数据；无账号、无网络仍可使用本地核心能力。
- AI：Local、BYOK Direct、Managed Stateless 三条 Route；Prompt 与输出 Schema 版本化，外发逐项目授权，AI 不可绕过 Memory Policy 写长期记忆。
- 产品验收：必须跨两个项目证明“确认记忆能再次召回”，素材存入数据库不算完成。
- 隐私：Workspace、Client、Project 作用域先过滤，再做本地检索、图谱扩展和 AI 上下文组装；删除证书只证明 App 可控数据面，不冒充已清理 Time Machine、iCloud、系统快照或 Provider 留存。
- 分工：Codex 负责需求、任务拆解、验收与测试；GLM 5.2 一次只实现一张任务卡，上一张经 Codex PASS 后才能继续。
