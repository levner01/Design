# 产品术语表

版本：v1.2  
目的：确保产品、设计、研发、数据、测试与 AI Prompt 使用同一套领域语言。英文名是代码/Schema 的建议统一名；最终字段以领域与数据模型为准。

## 1. 组织、用户与作用域

| 术语 | 中文 | 定义与边界 |
|---|---|---|
| User | 用户 | 使用产品的自然人；MVP 为个人设计师 |
| Workspace | 工作空间 | 本地数据、权限、作用域和配置的一级业务边界；MVP 通常一位用户一个本地个人 Workspace，不要求云账号 |
| Workspace Owner | 工作空间所有者 | MVP 唯一业务角色，可管理本空间数据、策略、导出和删除 |
| Owner Type / Owner ID | 所有者类型/标识 | 标记对象归个人、团队或其他主体，为未来团队能力预留 |
| Client | 客户 | 甲方或业务委托方；也是项目资料和客户记忆的隔离边界 |
| Stakeholder | 利益相关者/决策人 | 客户或项目中提出需求、评审或影响决策的人，不等同于系统登录用户 |
| Visibility | 可见性 | 对象可被哪些主体查看，如 `personal`、`project_private` |
| Scope | 作用域 | 内容可被使用、召回或学习的范围，不等同于 UI 可见性 |
| Project Scope | 项目作用域 | 内容仅可用于特定项目或允许的项目集合 |
| Client Scope | 客户作用域 | 内容仅可用于同一客户的项目，默认不得跨客户召回 |
| Memory Scope | 记忆作用域 | 记忆可用于当前会话、当前项目、客户、个人长期或未来团队的范围 |
| Learning Policy | 学习策略 | 指定内容是否允许生成个人/团队记忆，如 `allow`、`do_not_learn` |
| Project Cloud AI Grant | 项目云 AI 授权 | 对单个项目授权 BYOK 或 Managed Cloud 调用；必须披露 Provider、数据类型、最小必要上下文、留存边界和撤销方式，默认 `denied` |
| Web Search Policy | 全网搜索策略 | 指定项目是否允许查询外部公开来源，不等同于素材库检索 |
| Provenance | 来源/溯源 | 内容来自哪个原文、素材、项目、用户操作、关系或 AI 运行 |
| Audit Log | 审计日志 | 记录谁在何时执行关键变更；敏感正文不应被普通审计重复保存 |
| Local Business Store | 本地业务事实源 | 桌面端本地数据库与本地文件；素材、项目、记忆、Prompt/输出版本、索引和图关系均以此为准 |
| Optional Control Plane | 可选控制面 | 可使用 Supabase 承载账号、订阅、模型目录和 Managed Cloud AI 用量；不得保存业务正文、素材、记忆、原始 Prompt 或可重建它们的向量 |
| App-managed Backup | 应用管理备份 | 由 App 创建、知道位置并能恢复/删除的本地备份；与 Time Machine、iCloud、系统快照和用户手工副本不同 |

## 2. 项目与需求

| 术语 | 中文 | 定义与边界 |
|---|---|---|
| Project | 项目 | 一段有生命周期的设计工作，承载需求、证据、命题、决策、反馈、结果和复盘 |
| Design Case | 设计任务上下文 | 项目内一次具体设计问题及其目标、约束和判断环境；一个 Project 可含多个 Design Case |
| Design Domain | 设计领域 | 品牌、视觉、UI、UX、网页、包装等领域标识，用于选择模板、术语和方法包 |
| Source Document | 来源文档 | 导入的原始 Brief、PDF、Word、邮件、会议纪要、聊天截图、参考图等 |
| Source Span | 来源片段 | 可定位到原文页码、段落、时间码或图像区域的最小引用单元 |
| Requirement Statement | 需求原句 | 客户或相关方的原始表达，不被 AI 改写覆盖 |
| Explicit Requirement | 显性需求 | 来源材料直接陈述、可定位证据的要求 |
| Implicit Need | 隐性诉求 | 对未直接陈述目标的推测；默认属于 AI 推断或待验证假设 |
| Requirement Interpretation | 需求解释 | 对需求原句的结构化理解，必须带认知类型、来源和状态 |
| Goal | 目标 | 项目要达成的商业、用户、传播或体验结果 |
| Constraint | 约束 | 预算、时间、品牌规范、技术、渠道、合规等限制条件 |
| Risk | 风险 | 可能影响价值、交付、体验、安全或结果的不确定事件 |
| Ambiguous Term | 模糊词 | “高级、年轻、科技感”等没有天然统一执行含义的表达 |
| Requirement Conflict | 需求冲突 | 两条需求、目标、约束或利益相关者主张不能同时充分满足 |
| Information Gap | 信息缺口 | 作出判断所需但当前资料没有回答的信息 |
| Hypothesis | 假设 | 尚未验证、需要证据或客户确认的判断 |
| Clarifying Question | 澄清问题 | 为消除模糊、冲突或缺口而向客户/相关方提出的问题 |
| Acceptance Criterion | 验收标准 | 判断需求或方案是否达标的可观察条件，不等同于抽象形容词 |

## 3. 素材、来源与检索

| 术语 | 中文 | 定义与边界 |
|---|---|---|
| Capture | 采集任务 | 从浏览器扩展创建的幂等任务，负责链接/截图/局部/单图与上下文进入系统 |
| Import Batch | 导入批次 | 冷启动或批量本地导入的一组来源文件及逐项处理结果；Beta 单批最多 500 个文件，每 Workspace 同时 1 个活跃批次 + 1 个排队批次，UTC 单日最多 2,000 个文件 |
| Asset | 完整素材 | 完整网页、截图、海报、包装、视频、PDF、文档或历史作品 |
| Fragment | 局部素材 | 从 Asset 裁出的可独立引用局部，如标题排版、导航、卡片或摄影构图 |
| Visual Feature | 视觉特征 | 从一个或多个素材抽象的设计处理方式，如“用字号而非色彩建立层级” |
| Historical Work | 历史作品 | 用户过去完成、修改或被否决的设计产出，是 Asset 的特定业务角色 |
| Source | 素材来源 | 原始作者、网址、作品名、品牌、平台、发布时间等来源信息 |
| License Status | 许可状态 | 已知授权类型或 `unknown`；来源已记录不代表可商用 |
| Inbox | 素材收件箱 | 所有新采集/本地导入素材的待处理入口，按本地保存、分析和整理状态组织 |
| Library | 素材库 | 已进入 Workspace 的素材、局部和视觉特征的检索与管理空间 |
| Inspiration Board | 灵感板 | 围绕某主题或项目组织素材的集合；MVP 主要以项目证据板承载 |
| Exact Duplicate | 精确重复 | 规范化 URL 或内容哈希一致的重复内容 |
| Near Duplicate | 近似重复 | 视觉或内容高度相似但并非同一二进制/URL 的素材 |
| Full-Text Search | 全文搜索 | 基于标题、正文、用户笔记和已授权文本字段的词法检索 |
| Semantic Search | 语义搜索 | 使用 Embedding 按含义而非精确词匹配查询 |
| Visual Similarity Search | 视觉相似搜索 | 按视觉表示寻找相似素材；相似不等于项目相关或设计更好 |
| Fragment Search | 局部检索 | 以裁切局部或局部向量作为查询/结果单元 |
| Hybrid Retrieval | 混合召回 | 综合关键词、全文、向量、视觉、图谱关系和历史使用的召回方式 |
| Recall | 召回 | 根据当前查询或项目上下文取回相关素材、经验、方法或记忆 |
| Rerank | 重排 | 对候选结果依据当前任务、来源和用户反馈重新排序 |
| Why Recalled | 召回理由 | 系统对“为什么这条结果相关”的可读解释，必须来自真实召回信号 |
| Asset Lifecycle | 素材使用生命周期 | 未使用→再打开→进入项目→参与判断→影响方案→形成经验的事实轨迹 |

## 4. 判断、证据与决策

| 术语 | 中文 | 定义与边界 |
|---|---|---|
| Judgment Dimension | 判断维度 | 设计师用于比较方案的维度，如可信度、识别性或任务效率 |
| Judgment Criterion | 判断标准 | 某维度下可观察的正向/反向信号和验收条件 |
| Evidence | 证据 | 支持需求解释、判断、命题或决策的素材、原文、记忆、方法或结果 |
| Counter Evidence | 反向证据 | 挑战命题、判断或记忆的材料；不等同于“坏案例” |
| Positive Case | 正向案例 | 在当前项目和判断维度下支持目标的案例角色 |
| Negative Case | 反向案例 | 在当前上下文中展示应避免路径或反证的案例角色 |
| Boundary Case | 边界案例 | 用于澄清适用范围、仍待判断或接近阈值的案例角色 |
| Evidence Board | 证据板 | 按判断维度组织正向、反向和边界证据的项目视图；不是自由无限画布的代称 |
| Method | 方法 | 用户掌握、使用或评估过的设计方法与适用条件 |
| Design Strategy | 设计策略 | 为满足目标和约束选择的一组方法与方向原则 |
| Design Proposition | 设计命题 | 有需求依据、证据、风险和 Trade-off 的候选设计方向，不是最终设计稿 |
| Alternative | 候选方案 | 与其他命题/方向可比较的选择对象 |
| Trade-off | 权衡/代价 | 选择某方向时接受的损失、限制或风险 |
| Decision | 设计决策 | 用户对命题的选择、拒绝、搁置、理由、代价和未验证假设记录 |
| Decision Explanation | 决策说明 | 基于真实证据，面向客户、管理者、开发、团队、作品集或复盘生成的不同表达 |
| Feedback | 反馈 | 客户、用户、团队或验证活动对设计方向/结果的回应 |
| Outcome | 结果 | 项目、决策或方法实际产生的可观察结果；与主观满意度分开 |
| Project Review | 项目复盘 | 对需求变化、探索、反馈、结果和认知修正的可确认总结 |

## 5. 记忆与个性化

| 术语 | 中文 | 定义与边界 |
|---|---|---|
| Activity Event | 行为事件 | 追加式记录用户做了什么；它是可验证事实，不等于长期记忆 |
| Working Memory | 当前工作记忆 | 当前会话/项目的临时位置、假设和未解决问题，不自动升级为长期记忆 |
| Memory Candidate | 记忆候选 | 从用户表达、行为、决策或复盘提取、等待政策检查和用户审阅的归纳 |
| Memory | 个人记忆 | 通过 Memory Policy 且满足确认规则，可在允许作用域中召回的认知 |
| Memory Evidence | 记忆证据 | 支持或反对记忆的原文、行为、项目结果、反馈或用户操作 |
| Memory Conflict | 记忆冲突 | 两条记忆或证据在相同/重叠适用范围内相互挑战的状态 |
| Memory Policy | 记忆策略 | 决定内容能否提取、是否必须确认、作用域、冲突、衰减、调用和删除的规则层 |
| Stable Preference Memory | 稳定偏好记忆 | 长期审美倾向、明确厌恶项、原则或沟通偏好；重要推断必须确认 |
| Habit Memory | 行为习惯记忆 | 收藏、搜索、分组、视图和项目启动顺序等行为模式 |
| Episodic Project Memory | 项目情景记忆 | 特定项目的背景、需求、方向、反馈和结果 |
| Method Memory | 方法记忆 | 熟悉、常用、失效或可能适合的方法及条件 |
| Judgment Memory | 判断与决策记忆 | 在何种背景下依据什么作出什么选择并产生什么结果 |
| Failure Memory | 失败与反例记忆 | 被否决方案、错误判断、返工原因、无效方法和观点变化 |
| Growth Memory | 能力成长记忆 | 新认知、逐渐熟练/仍缺经验的领域及判断方式变化 |
| Confidence | 置信度 | 系统对内容得到证据支持程度的估计；高置信度不替代用户确认 |
| Applicability | 适用范围 | 记忆适用于哪些领域、客户、项目、阶段或条件 |
| Decay | 记忆衰减 | 随时间、未验证或环境变化降低召回权重，不等于自动删除 |
| Observed | 已观察 | 由可验证事件记录的事实状态，尚未归纳为长期结论 |
| Inferred | 已推断 | AI 或规则归纳但未确认的状态 |
| Pending | 待确认 | 等待用户审阅的候选状态 |
| Confirmed | 已确认 | 用户确认了内容和适用范围，可按设置召回 |
| Validated | 已验证 | 经后续真实项目结果进一步支持的状态 |
| Challenged | 被挑战 | 出现反向证据或用户质疑，召回时需展示冲突 |
| Deprecated | 已失效/废弃 | 不再作为建议调用，但可保留历史解释 |
| Deleted | 已删除 | 立即停止使用并按删除策略清理正文、向量、关系和派生数据 |
| Personal Dictionary | 个性化设计词典 | 记录模糊词在用户、客户和项目作用域中的不同含义、案例和演化 |
| Dictionary Term | 词条 | 如“高级、年轻、科技感”的规范词对象 |
| Dictionary Meaning | 词义 | 某词在特定作用域下经确认或待确认的具体含义 |
| Reverse Memory | 反向记忆 | 用反证、失败和未尝试路径挑战已有偏好或判断的机制 |
| Path Dependency | 路径依赖 | 因习惯或既有成功而反复选择同类路径，即使环境已变化 |
| Aesthetic Echo Chamber | 审美回音壁 | 推荐只强化过去偏好、减少探索和反证的系统性风险 |

## 6. AI、图谱与运行质量

| 术语 | 中文 | 定义与边界 |
|---|---|---|
| Epistemic Type | 认知类型 | `fact`、`client_opinion`、`user_judgment`、`ai_inference`、`hypothesis`、`validated_conclusion` 等 |
| Structured Output | 结构化输出 | 通过版本化 Schema 约束的 AI 输出；非法结构不得写业务主表 |
| Model Gateway | 模型网关 | 通过多 Provider Adapter 统一封装文本、视觉、Embedding、Rerank 和搜索能力的内部接口；用户选模不得绕过任务能力、项目云授权和路由边界，Managed 路由还受预算策略约束 |
| Local Model Adapter | 本地模型适配器 | 在用户设备上调用已安装本地模型的路由；业务上下文不离开设备，不消耗 Managed Cloud AI 配额 |
| BYOK Cloud Route | 自带密钥云路由 | 桌面端使用用户自己的 Provider 凭证直接调用云模型；凭证存操作系统安全存储，费用与留存责任按用户和 Provider 的合同执行 |
| Managed Cloud Route | 托管云路由 | 通过产品托管路由瞬时转发项目已授权的最小必要上下文；控制面只记录不含业务内容的计费与用量元数据 |
| Evaluated Model Allowlist | 受评测模型白名单 | 通过对应任务能力、质量、安全、隐私和结构化输出门禁后，允许用户设置为默认或按任务选择的模型集合；不等同于 Provider 的完整模型目录 |
| Default Model / Task Model | 默认模型/任务模型 | 用户可为 Workspace 设置默认模型，也可在具体任务前选择白名单模型；实际调用仍受任务能力与项目授权约束，Managed 路由额外受预算硬约束 |
| Prompt Version | Prompt 版本 | 可追溯的提示模板、变量和策略版本 |
| AI Run | AI 调用记录 | 仅存本地的一次 AI 任务记录，包含路由、模型、Prompt、Schema、来源、成本、延迟、状态和原始输出；控制面只可接收不含业务内容的 Managed 用量元数据 |
| Embedding | 向量表示 | 用于语义/视觉检索的数值表示；删除原内容时必须同步清理 |
| Eval Dataset | 评测数据集 | 用于稳定测试需求拆解、召回、记忆和安全质量的版本化样本集合 |
| AI Eval | AI 评测 | 自动与人工结合的质量、隔离、安全、幻觉、成本和回归验证 |
| Quality Gate | 质量门禁 | 模型/Prompt/检索/记忆策略升级必须达到的发布阈值 |
| Graph Node | 图谱节点 | 指向业务实体的图谱投影，不替代业务主记录 |
| Graph Edge | 图谱关系 | 带方向、来源、置信度、作用域和状态的实体关系 |
| Local Graph | 局部关系图 | 围绕当前需求、判断、素材、决策或记忆展示的任务化关系视图 |
| Domain Event | 领域事件 | 已发生业务事实的追加式通知，如 `DecisionSaved`、`ReviewConfirmed` |
| Job | 异步任务 | 图片分析、解析、Embedding、需求拆解、记忆、复盘、去重等后台工作单元 |
| Idempotency Key | 幂等键 | 确保重复提交/重试不会产生重复业务结果的唯一请求标识 |
| Soft Delete | 软删除 | 本地 T0 立即从界面、搜索、召回和 AI 上下文排除；T+7 前可恢复，恢复不得扩大原权限和作用域 |
| Hard Delete / Purge | 永久删除/清除 | T+8 起不可恢复；设备正常运行时最迟 T+30 清理 App 数据库、本地文件、索引、图关系、缓存、扩展队列、派生数据和应用管理备份 |
| Pending Device Run | 等待设备运行 | 设备长期未运行导致本地物理清理无法继续的状态；下次桌面端运行必须恢复 Purge，不得伪装为删除完成 |
| Deletion Certificate | 删除证明 | App 管理范围硬删除完成后的可核验记录；覆盖 App 数据库、本地文件、索引、缓存、扩展队列与应用管理备份，不覆盖 Time Machine、iCloud、系统快照、手工副本或外部 Provider 留存 |
| Suppression Fingerprint | 抑制指纹 | 不含正文、不可还原，用于防止已删记忆被旧事件重新生成的最小标识 |
| Degraded Mode | 降级模式 | 某增强能力失败时仍提供的可用路径，如语义检索降级为关键词搜索 |
| AI Cost Soft/Hard Limit | AI 成本软阈值/硬上限 | 仅适用于 Beta Managed Cloud AI：按用户每月 15 美元软阈值、20 美元硬上限；本地模型与 BYOK 不计入 |

## 7. 容易混淆的术语对

| 不要混用 | 区别 |
|---|---|
| Asset vs Fragment vs Visual Feature | 完整素材 vs 可独立引用局部 vs 从实例抽象出的处理方式 |
| Source vs Evidence | Source 描述内容从哪里来；Evidence 描述内容在当前判断中起什么作用 |
| Tag vs Judgment Dimension | Tag 用于描述/查找；Dimension 用于比较方案并定义标准 |
| Positive/Negative Case vs 素材永久属性 | 案例角色属于具体项目和判断维度，同一素材可在不同项目扮演不同角色 |
| Activity Event vs Memory | 行为事件是可验证事实；记忆是经政策和必要确认后的可召回归纳 |
| Confidence vs Confirmation | 置信度是系统估计；确认是用户授权和语义校准，两者不可互相替代 |
| Visibility vs Recall Scope | 可见性控制谁能看；召回作用域控制系统能否在新上下文里使用 |
| Local Business Store vs Cloud AI | 业务数据以本地为事实源；授权云 AI 只允许发送项目级最小必要上下文，不等于允许上传整个项目或持久化到控制面 |
| Control Plane vs Business Data Plane | 控制面只管账号、订阅、模型目录和 Managed 用量；业务正文、素材、记忆、原始 Prompt 与派生索引留在本地 |
| Requirement vs AI Inference | 需求有来源原句；AI 推断必须显式标记且可拒绝 |
| Decision vs Decision Explanation | Decision 是用户保存的选择事实；Explanation 是基于该事实面向不同受众的表达 |
| Knowledge Graph vs Graph UI | 图谱是底层关系模型；前端只按任务显示局部关系，不等于全局蜘蛛网 |
| Source Recorded vs Commercially Usable | 记录来源只提升可追溯性，不构成版权许可结论 |
