以下是所需要完成的一系列工作,你可以一步一步实现;但是务必保证功能实现完全;需要保存工作结果记录和完成度;
todolist每项任务在完成之后要求在原文的下方进行汇报进度;
新增要求（2026-04-02）:
应用配置不要再只保存在浏览器里，改为项目级 `config.json` 文件真源；前端与本地宿主统一通过同一套文件配置工作，并为后续 Electron 化保留兼容路径。

1.实现rag与记忆机制:
RAG策略:
使用混合检索(Hybrid search)包含向量检索和关键词检索BM25
第一阶段（基础 RAG）：文档获取 → 解析 → 清洗 → 递归切分 → 向量化 → 向量检索 → LLM 生成。这已经能覆盖 60% 的场景。

进度汇报（2026-04-01）:
已完成本地优先 RAG 的第一批基础设施：官方 SQLite wasm 已切换完成，文档库增加了递归切分后的 `document_chunks` 表、FTS5/BM25 检索、查询拆解、语义缓存键和搜索结果缓存表。
当前检索链路已具备"关键词检索 + BM25 排序 + 任务拆解 + 缓存"的本地基础能力，作为第一阶段的混合检索骨架先落地；向量检索、重排序和多层记忆生命周期仍待继续实现。
已补充自动化测试覆盖 chunking、任务拆解、缓存键、FTS 可用性检测、索引写入和缓存清理。

进度汇报（2026-04-01，第三次更新）:
已接入第一版向量检索：文档 chunk 现在可按 `text-embedding-v4` 生成向量并落到 `document_chunk_embeddings` 表，检索时会把 BM25 结果与向量相似度做混合排序。
文档设置页已新增 `enableVectorSearch / embeddingModel / embeddingBaseUrl / embeddingApiKey / embeddingDimensions` 本地配置项，不会写入 git。
已完成 live smoke test：通过 DashScope 兼容 `/embeddings` 接口成功返回 `text-embedding-v4` 的 1024 维向量，说明当前模型与 API key 可用。

第二阶段（进阶 RAG）：加入查询预处理（改写、扩展、分解）、重排序（Cross Encoder）、上下文压缩、后处理（忠实度检查）。

第三阶段（高级 RAG）：根据实际痛点选择引入 1-2 项高级技术。如果幻觉严重就加 Self-RAG，如果知识库不完整就加 Corrective RAG，如果需要关系推理就加 Graph RAG，如果文档很长就加 RAPTOR。

第四阶段（持续优化）：建立反馈闭环、批量评估体系、全链路监控，用数据驱动持续改进。

记忆机制:
我们希望设置长期记忆（全局记忆）和短期记忆，(可以加上当前会话记忆,用于重启恢复和当前任务的连续性)
短期记忆即每天日志，全局记忆即为短期记忆的浓缩(也可以是用户自然语言指定,也可以是全局记忆设置里直接加入)，
全局记忆加入晋升机制(用户明确指定,重复出现的信息也进行晋升)
全局记忆结构升级:引入知识图谱(Knowledge Graph)引入GraphRag,将用户的固定偏好,人物关系,项目状态提取为Node和edge,打造一个不断生长的结构化知识库

进度汇报（2026-04-01）:
已完成第一版分层记忆骨架：`agent_memory_documents` 新增 `memory_scope / source_type / importance_score / topic_id / event_date` 字段，支持长期记忆（global）和按日沉淀的短期记忆（daily）。
当前对话消息写入时会自动生成每日活动日志；当用户消息出现"记住 / remember / 默认 / 偏好 / 请始终"等显式长期记忆信号时，会自动晋升为 Agent 的长期记忆条目。
运行时记忆注入已升级为分层上下文组装：长期记忆直接注入，短期记忆按 hot / warm / cold 三层裁剪后注入模型。夜间压缩、冷层向量化、知识图谱和 Query Router 仍待后续实现。

进度汇报（2026-04-01，第四次更新）:
已补上第一批"近期记忆快照"能力：运行时注入除了长期记忆外，还会从 `daily / session` 记忆中生成 `Recent memory snapshot` 和 `Open loops` 两个段落，把最近对话摘要、关键片段以及包含 `TODO / 待办 / 阻塞 / next step` 等信号的未完成任务一起注入模型上下文。
设置页 `Memory` 分类新增"注入近期记忆快照"开关，允许按需关闭这类启动快照；旧配置会自动兼容并默认开启。
当前这一步完成的是"热层/温层可读快照 + 未完成任务提取"，尚未完成温层摘要替身持久化、冷层向量化归档、夜间自动压缩和时间指向型 Query Router。

进度汇报（2026-04-01，第五次更新）:
已开始把 agent 记忆切换为项目内 Markdown 真源：新增 `memory/agents/<agent-slug>/MEMORY.md` 与 `memory/agents/<agent-slug>/daily/YYYY-MM-DD.md` 的路径解析、迁移、扫描和派生索引同步逻辑，旧 SQLite 里的可迁移长期/每日记忆会自动落到这些文件。
运行时仍保持现有 LangGraph 框架不变，但当前 agent 的记忆上下文现在可以通过文件派生记录进入模型，而不是继续把 SQLite 当成唯一真源。
前端已补上文件记忆编辑入口，并新增本地 API server，用于直接读写项目里的 Markdown 记忆文件；SQLite 只保留检索索引与缓存职责。后续还需要继续完成温层摘要替身、冷层压缩和时间指向型 Query Router。

进度汇报（2026-04-01，第六次更新）:
已完成第一批温层/冷层生命周期：当前 agent 的每日记忆会保留原始 `daily/YYYY-MM-DD.md`，并按时间窗口生成 `*.warm.md` 与 `*.cold.md` 摘要替身文件。
运行时和派生 SQLite 索引现在都会按日期 tier 选择当前生效表示：热层优先原始 daily，温层优先 warm 替身，冷层优先 cold 替身；原始 daily 仍然保留为唯一真源。
设置页 `Memory` 分类已补上“同步温冷层”按钮，并会显示扫描数、warm/cold 更新数和失败数，方便手动重建替身与索引。下一步剩余的是夜间自动归档、冷层向量化和时间指向型 Query Router。

进度汇报（2026-04-01，第七次更新）:
已完成第一版时间指向型 Query Router：运行时组装记忆上下文时会先对用户当前问题做轻量规则路由；如果命中明确旧时间表达（如具体日期、上个月、去年且超过 15 天），则直接优先检索冷层与全局记忆。
普通问题和模糊时间表达会先检索热层/温层/全局记忆；当近期层可用记忆不足时，再自动回退补充冷层，避免每次都把久远冷层噪音注入模型。
前端发送链路也已经把当前用户 query 传入记忆选择逻辑。当前剩余的是冷层向量化归档、夜间自动归档、重要性评分驱动驻留和更细粒度的 Query Router 扩展。

进度汇报（2026-04-01，第八次更新）:
已完成第一版冷层向量化归档：当前 agent 的有效 `cold.md` 会同步写入独立的 `agent_memory_embeddings` 表，复用现有 embedding 配置与客户端生成可重建的冷层语义向量，不再混用知识库文档向量表。
运行时在 Query Router 命中 `explicit_cold`，或热温层记忆不足时，会按当前 query 触发冷层向量检索，只补入语义最相关的少量冷层摘要，而不是把所有冷层条目都注入 prompt。
当前剩余的是夜间自动归档、重要性评分驱动驻留、将全局/热/温层逐步并入统一 memory RAG，以及更细粒度的 Query Router 扩展。

进度汇报（2026-04-02，第九次更新）:
已完成第一版夜间自动归档：本地 `api-server` 现在内置 nightly scheduler，可按项目级 `.flowagent/nightly-memory-archive-settings.json` 配置在固定时间执行 agent 记忆生命周期同步。
如果夜间服务未开启，`api-server` 下次启动时会自动检测错过的时间窗并补跑一次归档；归档结果与失败摘要会写回 `.flowagent/nightly-memory-archive-state.json`，不会因为单个 agent 失败而阻塞其他 agent。
设置页 `API 服务器` 分类已新增“夜间自动归档”卡片，可直接启用任务、设置时间并查看最近一次执行、下一次计划时间和补跑状态。当前剩余的是重要性评分驱动驻留、将全局/热/温层逐步并入统一 memory RAG，以及更细粒度的 Query Router 扩展。

进度汇报（2026-04-02，第十次更新）:
已开始把应用配置从浏览器 `localforage` 迁移到项目级 `config.json`：当前仓库已新增 `config.example.json` 模板，`config.json` 会作为本地私有配置文件存在于项目根目录，并加入 `.gitignore`。
本地 `api-server` 已补上 `/api/config` 读写接口，前端配置读取会优先走 host bridge；若发现旧浏览器配置且当前文件配置仍是默认值，会自动把 legacy 配置迁移到 `config.json`。
开发态启动链路也开始向“内置宿主服务”收口：`npm run dev` 现在会同时带起前端和本地 `api-server`，为后续 Electron 封装预留同一套 host/config 结构。当前剩余的是把所有设置写入路径完全切到文件真源，并在此基础上接入 LLM 夜间重要性评分。

进度汇报（2026-04-02，第十一次更新）:
已完成第一版夜间 LLM 重要性评分：夜间归档现在可以复用当前 `config.json` 中的活动模型，对进入 warm/cold 生命周期的 `daily/YYYY-MM-DD.md` 进行 `1-5` 分重要性评估。
评分结果会写入 `*.warm.md` / `*.cold.md` frontmatter，包括 `importance`、`importanceReason`、`importanceSource`、`retentionSuggestion` 和 `promoteSignals`，并同步到派生 SQLite 的 `importance_score`；当前仍不会自动改写 `MEMORY.md`。
若模型调用失败、配置缺失或返回格式异常，归档会自动回退到现有规则评分，不阻塞温冷层同步。设置页 `API 服务器 -> 夜间自动归档` 已新增“启用 LLM 重要性评分”开关。当前剩余的是把高分记忆的长期晋升策略正式闭环，以及将全局/热/温层逐步并入统一 memory RAG。

进度汇报（2026-04-02，第十二次更新）:
已把长期晋升闭环推进到第一版：夜间归档现在不只看 `importance`，还会基于加权 `promotionScore` 决定是否把记忆晋升到 `memory/agents/<agent-slug>/MEMORY.md` 的 auto-managed learned patterns 区块。
当前晋升触发不再只依赖高分，还包括三类稳定信号：用户明确要求、重复出现的稳定结论、以及被模型判定为高抽象/高迁移/已验证的经验模式。自动分类目前按 `Behavioral Patterns / Workflow Improvements / Tool Gotchas / Durable Facts` 四类写入。
LLM 评分 rubric 已补入这些维度：压缩率、时效性、关联度、冲突解决、经验高度抽象、用户反馈黄金标签、多场景可迁移性；并支持通过 `config.json -> memory.scoringWeights` 调整权重，通过 `memory.promotionScoreThreshold` 调整晋升阈值。
后续还要把这套“可调权重”扩展到 RAG 链路，例如 rerank、上下文压缩和图谱连接权重，但这部分会在后续 RAG 优化阶段单独接入，避免和当前记忆晋升逻辑耦合过深。

全局记忆每次更新，会建立 rag 索引，
每日记忆改为实时增量索引,当天内容也能及时检索,夜间再做压缩;且 2 天内保留索引（热层），
3-15天(温层)只留存摘要，元数据，关键词等替身,
15天(冷层)，把文档处理成超精简的摘要,关键词标签和时间索引,只存储向量和元数据,原文可备份删除,(触发条件是热温层查询无结果时查询冷层);
期望是在重启或者开启对话时（可选择），加载全局固定记忆,以及最近的对话摘要,还有未完成任务,近期关键片段，温层部分处理;

对于久远的冷层，等到必要的时候（用户提问 orelse）才触发全量 rag 索引
在用户提问介入时，增加一个轻量级的意图分类器（Query Router）。如果用户的提问明显带有时间指向性（例如："我上个月让你写的那个企划案的核心逻辑是什么？"），系统应直接跳过热温层，并行或直接去检索冷层和全局记忆。

自动生命周期:每天凌晨时对超过期限的文件进行归档,生成摘要替身,并把摘要向量化,存入向量库;
温层保存原文压缩包和摘要向量;
冷层删除原文,只保留摘要向量和元数据;

每日凌晨归档时,让LLM顺便打一个重要性评分(1-5),高分信息(如核心身份,偏好,重要决策)长期驻留在全局记忆或者温层的元数据中,低分信息(日常闲聊)可以执行15天冷层压缩

2.我们构建了 rag ，知识库与 skills.md 的结合，每当 skills 文件夹更新时会建立新的索引，并更新个人知识库，，记录于 rag，
用户提出相关的任务时，会自动触发 rag，自动检测知识库中相关的 md 文档，因此更容易触发 skills 命中。

进度汇报（2026-04-01）:
已先实现与该目标直接相关的底层能力：知识库检索现已支持任务拆解层和语义缓存，可为后续 `skills.md / skills` 目录建立独立索引提供统一检索入口。
当前尚未接入对 `skills` 文件夹变更的自动监听与重建索引；下一阶段将把本地知识库索引器扩展到 `skills.md` 与技能目录，并把命中结果接入技能选择流程。

进度汇报（2026-04-01，第二次更新）:
已接入项目内 Markdown 文档自动同步：应用启动时会把 `README.md`、`todo-list.md`、`docs/**/*.md`，以及未来新增的 `skills.md`、`skills/**/*.md` 自动同步到本地知识库。
知识库新增了 `document_metadata` 表，记录 `source_type / source_uri / tags / synced_at`，并能识别 `skill_doc`、`workspace_doc`、`user_upload` 等来源。知识库面板也会显示文档来源和标签，便于确认 skill 文档是否已进入索引。
当前"自动同步"范围限定在项目内可打包的 Markdown 文档；宿主机外部目录监听与热更新仍待后续补上。

进度汇报（2026-04-02）:
已把 skills 机制收口到更接近 Codex / Claude Code 的 `SKILL.md` 语义：
- 共享层：`skills/**/SKILL.md`
- agent 私有层：`memory/agents/<agent-slug>/skills/**/SKILL.md`

当前已完成：
- 本地 `api-server` 已能扫描共享 `README.md / todo-list.md / docs/**/*.md / skills/**/SKILL.md`
- 前端启动后会通过 host 接口自动同步共享 docs/skills，并清理失效索引
- 共享 docs/skills 已改成 host watcher + 事件流驱动，不再只靠前端定时轮询
- 对话发送前会补扫当前 agent 私有 skills
- skill 命中已接入运行时 system prompt，默认按“agent 私有优先，共享兜底”注入
- `search_knowledge_base` 工具现在会返回 `skill_doc` 元数据，便于模型显式调用时识别技能来源

当前仍待继续：
- 私有 skills 的前端可视化编辑入口还没单独做出来
- skill 命中后的执行策略仍以 prompt 注入为主，还没扩展到更细粒度的显式 workflow/step 触发

优化:
a.在 RAG 检索前，引入一个轻量级的 "任务拆解层"（Task Planning）。
先让模型把用户的复杂意图拆解为子任务：["查询日志", "发送邮件"]。
然后对这两个子任务分别执行知识库 RAG，召回组合技能。
b.引入"高频技能缓存"（Semantic Cache)

某些基础技能（例如：Web Search 或 Read File）的触发频率极高。
如果每次触发都要走一遍完整的"提问 -> Embedding -> 向量库检索 -> 排序"，会增加无意义的系统延迟。
可以设置一个"常驻技能组"（无需检索，永久写在 Prompt 中）和"扩展技能组"（通过 RAG 动态召回）。
或者在 RAG 前面加一层语义缓存，相同的任务意图直接返回对应的技能列表。

进度汇报（2026-04-01）:
已完成第一版语义缓存基础能力：搜索请求会先归一化成稳定 cache key，命中后直接返回缓存结果，未命中时再进入 FTS/BM25 检索并回写缓存。
缓存失效策略已接入文档新增、更新、删除、导入和索引补建流程，避免返回旧知识片段。

3.
Session → Agent 映射：每个会话创建独立的 Agent 实例
    状态隔离：每个实例有自己的上下文、记忆、工具状态
    共享资源：知识库、向量索引等只读资源可共享

进度汇报（2026-04-02，第一次更新）:
已开始把 `Topic` 提升为真正的会话级实例：
- `topics` 已新增 `session_mode / display_name / system_prompt_override / provider_id_override / model_override / enable_memory / enable_skills / enable_tools / enable_agent_shared_short_term`
- 生成状态已从全局布尔值改成按 `topic` 跟踪，为不同会话并行处理打基础
- 已接入第一版 `Quick Topic`，默认关闭记忆、skills、tools，只保留模型 + 身份 + 提示词的轻量对话路径
- 记忆读取规则已开始分层：会话短期记忆可按 `topicId` 隔离，agent 共享短期记忆继续由 `config.json` 控制，默认关闭

当前仍待继续：
- 会话级模型/提示词/开关的可视化设置面板
- 更完整的不同 topic 并行流式体验与状态恢复
- `quick` 与普通 `agent` 会话的入口和管理体验继续打磨

进度汇报（2026-04-02，第二次更新）:
- 已补上前端运行时错误边界，页面渲染异常不再直接白屏，而是会显示原始错误与组件栈
- 已修复会话实例改造后的空值访问问题：`workspace` 暂时为空时，聊天页会安全回退到派生显示名和模型
- 本地 API 请求失败时，现在会把具体请求 URL 一起带出来，方便继续排查 host/config 链路

进度汇报（2026-04-02，第三次更新）:
- 已补上 topic 级“会话设置”面板：当前会话可单独覆盖 `display_name / system_prompt_override / provider_id_override / model_override / enable_memory / enable_skills / enable_tools / enable_agent_shared_short_term`
- 聊天页顶部已加入会话设置入口，`Quick` / 普通 `Agent` 会话都可以直接编辑自己的 runtime 配置
- 分组模型选择弹窗已复用到 topic 级模型覆盖，不再只会修改全局模型

进度汇报（2026-04-02，第四次更新）:
- 已补上 topic 级停止控制：每个会话都可以单独停止自己的流式生成，不会误伤其他会话
- 手动停止后会保留已经流出的 partial 响应，并写回会话消息，不再一律落成通用报错
- topic 列表、头部和输入区已显示运行中状态，后台仍在生成的其他会话也能直接看见

进度汇报（2026-04-02，第五次更新）:
- Quick Topic 不再走浏览器 `prompt`，而是改成应用内创建面板，可在创建前填写标题、身份、提示词与模型
- 左侧 topic 列表已新增 `All / Agent / Quick` 模式筛选，并显示各自数量，便于在多会话并行时快速定位
- Quick 会话创建流程已复用现有分组模型选择器，不再单独维护第二套模型 UI

进度汇报（2026-04-02，第六次更新）:
- 已加入第一版 `Branch Topic`：当前会话可以派生一个子任务分支，并作为独立 topic 并行运行
- branch topic 会继承父会话的 runtime 设置，同时只带一份精简的父会话上下文快照，不会静默复制整段历史
- 聊天页头部和 topic 列表已标出 `Branch` 身份，并显示父会话来源，作为单 agent 子任务并行的第一版产品入口

当前仍待继续：
- 同 topic 下更复杂的多子代理编排与结果汇总机制仍未展开
