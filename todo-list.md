以下是所需要完成的一系列工作,你可以一步一步实现;但是务必保证功能实现完全;需要保存工作结果记录和完成度;
todolist每项任务在完成之后要求在原文的下方进行汇报进度;
状态约定:
- `✅` 已完成 / 已落地
- `⬜` 待做 / 未完成
- 待办事项使用数字编号，方便区分不同事项；完成后保留编号并把状态改为 `✅`
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

进度汇报（2026-04-02，第七次更新）:
- branch topic 现在可以把结果一键回传到父会话，形成第一版子任务汇总链路
- 回传内容采用紧凑摘要，只携带 handoff note 和最近 branch 结论，不会把整段 branch 历史直接并回 parent
- branch 自己也会记录一条 handoff system note，方便追溯该次回传是否已经完成

进度汇报（2026-04-02，第八次更新）:
- 已在聊天壳层加入 branch 导航条：父会话可直接看到自己的子分支列表
- branch 会话现在也能直接跳回 parent，或横向切到 sibling branches
- 这一层仍然只复用现有 topic 列表推导关系，没有额外引入新的存储模型

进度汇报（2026-04-02，第九次更新）:
- 已开始补 RAG 第二阶段的第一步：知识库检索前现在会做确定性 query rewrite / expansion
- 当前 rewrite 先覆盖对话化问法清洗、有限同义词扩展，以及中英混合别名桥接，避免直接把模型重写引入到主链路
- 本地知识库检索现在已经能支持类似“中文任务问法 -> 英文 skill/doc 文档”的首轮召回增强

进度汇报（2026-04-02，第十次更新）:
- 已加入第一版二阶段 rerank：混合召回后的候选现在会按 query coverage 再重排，而不是只做一次 lexical/vector 线性融合
- 当前 rerank 先使用标题命中、正文命中和 exact phrase 奖励这些确定性信号，不引入模型重排
- 这样后续接 context compression 和忠实度检查时，前置候选顺序已经更稳定了

进度汇报（2026-04-02，第十一次更新）:
- 已补上确定性的 context compression：知识库检索结果现在会围绕 query hit 裁出更短的 focused excerpt
- 当前压缩发生在检索返回阶段，不会改动原始文档存储，只减少下游 prompt / tool 的上下文占用
- RAG 第二阶段现在已经有 `query rewrite + rerank + context compression` 三段基础链路

进度汇报（2026-04-02，第十二次更新）:
- 已补上第一版 deterministic faithfulness check：每条知识库检索结果现在都会带 `supportScore / supportLabel / matchedTerms`
- `searchKnowledgeDocuments()` 已改成保留压缩后的 excerpt，不再映射回完整正文覆盖掉检索结果
- 这样本地 `search_knowledge_base` 工具已经具备“召回 -> 重排 -> 压缩 -> 支持度标记”的完整基础链路

进度汇报（2026-04-02，第十三次更新）:
- 已补上第一版 graph-assisted retrieval：知识库索引现在会为文档派生 `document_graph_nodes / document_graph_edges`
- 检索时会从 query 中抽取技术实体，与文档图节点做 overlap 打分，并把该信号作为 lexical/vector 之外的附加排序因子
- 检索结果现在会返回 `graphHints`，方便确认当前命中究竟是哪些术语或结构关系在辅助召回

进度汇报（2026-04-02，第十四次更新）:
- 已补上第一版 corrective retrieval：当首轮知识库结果过少或支持度偏弱时，会再生成一组有界的补救查询
- 当前补救查询优先利用首轮结果里的 `matchedTerms / graphHints`，把模糊问法往更具体的技术术语或结构字段上收窄
- 最终结果会把主检索与补救检索合并重排，并返回 `retrievalStage = primary / corrective / hybrid` 供后续观测和 UI 接线使用

进度汇报（2026-04-02，第十五次更新）:
- 已把 `document_graph_edges` 真正接入检索链：query 命中直接图节点后，会有一层有界的邻接扩展信号参与排序
- 当前实现会把二阶邻接实体单独记为 `graphExpansionHints`，避免和直接命中的 `graphHints` 混在一起
- 这样即使用户问题没有直接提到某个字段名或术语，只要它和当前 query 实体在图里有稳定邻接关系，也能以较弱分值把相关文档拉进候选集

进度汇报（2026-04-02，第十六次更新）:
- 已把证据层真正接到 agent 侧：`search_knowledge_base` 不再只返回原始结果数组，而是带 `evidence summary + per-result support / retrievalStage / graph metadata`
- 当前工具结果会显式给出 `answer_with_citations / answer_carefully / request_more_evidence` 这类 recommendation，便于模型按证据强弱调整回答力度
- runtime system prompt 也已补上窄范围 grounding 指令：知识库证据弱时要降级表述，证据强时优先引用标题或来源

进度汇报（2026-04-03，第十七次更新）:
- 已把图检索从“节点命中 + 一跳邻接”推进到“有界两跳扩展 + 路径证据”
- 检索结果现在除了 `graphHints / graphExpansionHints`，还会带 `graphPaths`
- 这样 agent 不只知道命中了哪些术语，还能看到类似 `branch handoff -> parent_topic_id -> review audit record` 这种图谱连接路径，后续继续做 GraphRAG 时可以直接把路径当成可解释证据使用

进度汇报（2026-04-03，第十八次更新）:
- 已把 `daily` source log 的记录粒度调细：原先每条消息只写一行 `时间 + topic + 作者 + 内容`，现在会额外记录角色、附件摘要、工具调用摘要，以及 `open_loop / decision` 这类显式状态信号
- `conversation_log` 仍然保持 Markdown 友好格式，但已从“单行活动记录”升级为“块级活动记录”，便于夜间 warm/cold lifecycle 在不读取完整 transcript 的前提下抓到更多结构化线索
- 当前尚未开始长对话 `session summary`，也就是消息上下文仍以 `historyWindow` 截断为主；这部分已保留为后续待办

当前仍待继续：
1. ⬜ 同 topic 下更复杂的多子代理编排与结果汇总机制仍未展开
2. ⬜ 第一版“自然语言任务 -> 持久化 task graph / planner-dispatcher-worker-reviewer workflow”已落地，branch handoff 已能推进 worker 节点到 `completed`，所有 worker 完成后会自动生成 `review_ready` 汇总并创建 reviewer branch，worker 节点可创建 retry branch 重新执行；仍缺真正后台模型执行
3. ⬜ 第一版会话级 `session summary` 已落地，并已完成与消息级 token 预算联动；后续还需补上更高质量的 LLM 摘要与摘要分段更新策略
4. ✅ daily 日志条目已升级为更细粒度记录：保留 user / assistant / system / tool 回合类型、更长工具调用结果、附件摘要与显式任务状态变更，再由夜间 lifecycle 统一压缩到 `warm/cold` 替身

进度汇报（2026-04-14，Electron 第一阶段启动）:
- ✅ 已加入 Electron 第一版桌面壳：新增 `electron/main.mjs` 与 `electron/preload.mjs`，renderer 仍复用现有 React/Vite 应用，主进程负责窗口与 host bridge 生命周期
- ✅ 已新增 `desktop:dev` 与 `desktop:preview` 脚本；`desktop:preview` 会用 Electron build mode 构建相对资源路径，并在预览时自动拉起本地 `api-server`
- ✅ 已补上 Electron preload 状态桥：renderer 现在可以通过安全 preload 读取桌面平台、Electron/Chrome/Node 版本和 host bridge 状态，后续 UI gating 不需要开启 Node integration
- ✅ 已补上 Electron 数据路径解析：开发态继续使用仓库根目录，打包态可默认切到 macOS Application Support 下的 `FlowAgent/workspace`，后续正式 `.app` 不再强依赖源码目录
- ✅ 已完成输入性能第二轮优化：聊天输入框已拆成独立 `ChatComposer`，输入文字使用本地状态，发送时再把文本、附件、联网搜索开关和 provider 快照传回父级，避免长对话每次按键触发整个 `ChatInterface` 与消息列表重渲染
- ✅ 已完成第一版桌面 capability gating：Electron preload 会返回 host/filesystem/sandbox 能力，前端统一生成 runtime capability profile，并在聊天头部、Sandbox 面板和 API Server 设置页显示当前运行模式；Phase 1 仍保持 WebContainer 沙盒优先，host shell 默认关闭
- ✅ 已完成第一版 unsigned macOS `.app` 打包：新增 `desktop:build`，本地生成 `release/mac-arm64/FlowAgent.app`；packaged app 已实测可自动启动内置 host bridge，并把数据根目录切到 `~/Library/Application Support/FlowAgent/workspace`
- ✅ 已完成第一版 host bridge 预编译：新增 `build:host`，把 `server/api-server.ts` 打成 `dist-host/api-server.mjs`；Electron 会优先启动该 bundle，packaged app 不再需要携带 `src/` / `server/` TS 源码或依赖 `tsx` 运行 host
5. ⬜ 仍待继续：签名与公证

进度汇报（2026-04-14，Electron 第一阶段第二次更新）:
- ✅ 已完成聊天壳层第一轮瘦身：左侧窄轨、topic 侧栏、聊天头部和模型选择区已统一收紧 padding / badge / icon / 字号占位，主对话画布的横向空间占比更高
- ✅ 已把运行中视觉噪音进一步压低：`Running / Streaming` 等状态标签收口为更短的 `Live`，保留状态信息但减少头部与列表拥挤感
- ✅ 已通过前端校验：当前 UI 收口改动已重新通过 `npm run lint` 与 `npm run build`

进度汇报（2026-04-14，Electron 第一阶段第三次更新）:
- ✅ 已补上桌面运行态观测：Electron 主进程新增轻量诊断接口，可返回主进程 PID、RSS/Heap、应用运行时长、系统内存，以及 host bridge 的 PID、最近启动时间、可达性与响应延迟
- ✅ 设置页 `API 服务器` 已新增紧凑型 `Runtime Diagnostics` 卡片，可随时刷新查看当前桌面壳与 host bridge 状态，无需打开 DevTools 才能定位运行态问题
- ✅ 已重新通过 `npm run lint`、`npm run build` 与 `npm run desktop:build`；当前仍遗留 `asar disabled / unsigned macOS app` 两项打包告警，作为后续继续收口项保留

进度汇报（2026-04-14，Electron 第一阶段第四次更新）:
- ✅ 已启用 `asar` 打包，并将 `dist-host/api-server.mjs` 收口到 `asarUnpack`；`desktop:build` 不再出现 `asar usage is disabled` 告警
- ✅ 已修复 packaged app 在 `asar` 模式下的 host bridge 启动问题：打包态不再拿 `app.asar` 作为子进程工作目录，避免 `spawn ENOTDIR`
- ✅ 已完成实机验证：`release/mac-arm64/FlowAgent.app` 启动后可正常拉起内置 host bridge，`/health` 返回正常，数据根目录仍落在 `~/Library/Application Support/FlowAgent/workspace`

进度汇报（2026-04-14，Electron 第一阶段第五次更新）:
- ✅ 已生成并接入第一版 macOS 应用图标：新增 `electron/assets/icon-base.png`、`electron/assets/icon.icns`，风格对齐当前深色蓝紫品牌主题
- ✅ `desktop:build` 已不再出现 `default Electron icon is used` 告警，说明打包产物已使用自定义 app icon
- ✅ Electron 第一阶段目前仅剩发布链路相关收口：macOS 签名与公证

进度汇报（2026-04-14，会话级 Agent 第四次更新）:
- ✅ 已补上第一版自然语言任务编译层：当前会话可以把用户的任务目标编成持久化 `task graph`，固定落成 `planner -> dispatcher -> worker branches -> reviewer` 四段式骨架
- ✅ 已新增 `topic_task_graphs / topic_task_nodes / topic_task_edges` 持久化，并把编译结果写回当前 topic；worker 节点会自动创建 branch topics，继续复用现有 branch bootstrap 与会话隔离
- ✅ 聊天页 `Branch Task` 弹窗已升级为 `单分支 / 工作流拆解` 双模式；工作流模式创建成功后会刷新父 topic，并显示生成的 worker branch 数量
- ✅ 已完成最小验证：`npm run lint`、`npm run build` 通过，并额外跑过一条本地 compiler smoke，确认 fallback 模式能稳定生成任务图

进度汇报（2026-04-14，会话级 Agent 第五次更新）:
- ✅ 已补上第一版会话级 `session summary` 压缩：当 user/assistant 历史超过 `historyWindow` 时，会在 workspace 层把较早轮次压成持久化摘要，而不是每次只靠硬截断丢弃
- ✅ 摘要已接入发送链路：运行时 system prompt 现在会注入 `Session summary`，同时仍保留最近 `historyWindow` 条原始消息，形成“摘要 + 近窗消息”的组合上下文
- ✅ 当前摘要为确定性压缩：会提取较早 user 请求、assistant 输出和 open loops，并写入 `topics.session_summary*` 字段；后续仍可继续升级为 LLM 摘要
- ✅ 已重新通过 `npm run lint` 与 `npm run build`

进度汇报（2026-04-14，会话级 Agent 第六次更新）:
- ✅ 已补齐 `session summary` 的关键边界：重生成回复现在会按“当前重生锚点之前的消息”重新计算摘要，避免把待重生后的消息误带进上下文
- ✅ 已补齐删除消息与 branch handoff 后的摘要刷新，避免 transcript 变更后 `topics.session_summary*` 长时间漂移
- ✅ 已把摘要持久化从“整库 FTS rebuild”收口为“仅保存 DB”，降低长会话下的刷新成本；当前仍未做增量摘要和并发版本保护，保留为后续项
- ✅ 已补上最小测试覆盖：新增 `session summary` 纯逻辑测试与 schema 列回归断言，并重新通过 `node --import tsx --test tests/agent-workspace-schema.test.ts`、`node --import tsx --test tests/session-runtime-model.test.ts`、`npm run lint`、`npm run build`

进度汇报（2026-04-14，会话级 Agent 第七次更新）:
- ✅ 已升级 `daily` source log 的单条记录结构：在保留原有首行格式的基础上，新增 `Turn: user_request / assistant_response / system_event / tool_event` 子行，便于后续 warm/cold 压缩识别回合类型
- ✅ 工具调用摘要现在保留更长的结果预览，并新增 `Task State: blocked / completed / tool_failed / tool_running`，让显式任务状态变更能进入 Markdown 真源和派生 RAG 索引
- ✅ 该改动只落在 `buildConversationMemoryEntry` 模型层，不改变 `upsertDailyMemoryLog` 持久化链路；已通过 `node --import tsx --test tests/knowledge-memory-model.test.ts`、`npm run lint`、`npm run build`

进度汇报（2026-04-14，会话级 Agent 第八次更新）:
- ✅ 已补上 workflow branch handoff 的第一段状态推进：当 worker branch 把结果回传 parent topic 时，会自动把匹配的 `topic_task_nodes.branch_topic_id` 节点标记为 `completed`
- ✅ `handoffBranchTopicToParent()` 现在会返回 `completedTaskNodes`，为后续 UI 展示、dispatcher 汇总和 reviewer 启动提供稳定数据入口
- ✅ 已补上回归测试覆盖“编译 workflow -> 创建 worker branch -> handoff -> worker node completed”的闭环，并通过 `node --import tsx --test tests/session-runtime-model.test.ts`、`npm run lint`、`npm run build`

进度汇报（2026-04-14，会话级 Agent 第九次更新）:
- ✅ 已补上 workflow 的 deterministic review-ready rollup：当同一 task graph 下所有 worker branch 都完成 handoff 后，graph 状态会从 `ready` 推进到 `review_ready`
- ✅ parent topic 会自动追加一条 `Workflow Reviewer` system message，列出已完成 worker branches 和下一步 review 指引；重复 handoff 不会重复生成 review-ready rollup
- ✅ 已补上回归测试覆盖“首个 handoff 不生成 rollup、最后一个 handoff 生成一次 rollup、重复 handoff 不重复生成”的幂等路径，并通过 `node --import tsx --test tests/session-runtime-model.test.ts`、`npm run lint`、`npm run build`

进度汇报（2026-04-14，会话级 Agent 第十次更新）:
- ✅ 已补上 reviewer branch 自动创建：workflow 进入 `review_ready` 后，会基于 parent topic 自动创建 `<graph title> · Reviewer` 分支，并把 reviewer 节点的 `branch_topic_id` 写回 `topic_task_nodes`
- ✅ 已新增 `topic_task_graphs.reviewer_branch_topic_id` 作为持久化幂等键，避免重复 handoff 或后续重试时重复创建 reviewer branch
- ✅ reviewer branch 仍不直接后台调用模型，而是沿用现有 branch topic 隔离架构；后续可在该 topic 中执行 reviewer agent 或做 UI 引导
- ✅ 已补上 schema 和 workflow 回归测试，并通过 `node --import tsx --test tests/agent-workspace-schema.test.ts`、`node --import tsx --test tests/session-runtime-model.test.ts`、`npm run lint`、`npm run build`

进度汇报（2026-04-14，会话级 Agent 第十一次更新）:
- ✅ 已补上 workflow worker 节点重试 API：`retryWorkflowBranchTask({ branchTopicId, reason })` 会基于旧 worker branch 创建 replacement branch，并把原 task node 的 `branch_topic_id` 指向新分支、状态重置为 `ready`
- ✅ 如果重试发生在 reviewer 已生成之后，会清空 `topic_task_graphs.reviewer_branch_topic_id` 和 reviewer node 的 branch 引用，并把 graph 状态退回 `ready`，避免旧 reviewer 输出继续代表新执行状态
- ✅ old branch 与 parent topic 都会记录 `Workflow Retry` system note，便于追踪重试链路；重试 branch 再次 handoff 后会重新生成 review-ready rollup 与新的 reviewer branch
- ✅ 已补上回归测试覆盖 retry、旧 reviewer 失效、新 retry branch handoff 后重新进入 review-ready，并通过 `node --import tsx --test tests/session-runtime-model.test.ts`、`npm run lint`、`npm run build`

进度汇报（2026-04-14，会话级 Agent 第十二次更新）:
- ✅ 已补上会话上下文预算联动：发送给模型的 live message history 和 `session summary` 的摘要源现在使用同一套 token budget 边界，超出预算的较早消息会进入摘要源，不再被静默丢弃
- ✅ 已抽出共享消息 token 估算 helper，前端发送路径与 workspace 摘要构建都会统一计算文本、图片附件和工具调用摘要，避免两条路径因为估算口径不同产生边界漂移
- ✅ 当前上下文估算已纳入持久化 `Session summary` 与预算后的近窗消息；后续仍保留 LLM 摘要与摘要分段更新作为独立待办
- ✅ 已补上回归测试覆盖预算 splitter、附件/工具估算、以及 `buildTopicSessionSummary()` 的 token-budget overflow 路径，并通过 `node --import tsx --test tests/session-context-budget.test.ts`、`node --import tsx --test tests/session-runtime-model.test.ts`、`npm run lint`、`npm run build`

---

## 架构优化 (2026-04-14)

### P0 — 可维护性

⬜ **4. 拆分 agent-workspace.ts (3929 行)**
拆分为 5 个文件：
- `workspace-schema.ts` — 表定义和初始化
- `workspace-queries.ts` — CRUD 操作 (topics, messages, lanes, tasks)
- `memory-sync.ts` — 文件 ↔ DB 同步
- `topic-management.ts` — Topic 创建/分支/handoff
- `task-graph.ts` — Task Graph 编译/状态推进

⬜ **5. 拆分 db.ts (3330 行)**
拆分为 4 个文件：
- `db-schema.ts` — 建表 + 索引 + FTS5
- `db-queries.ts` — 文档/对话 CRUD
- `db-search.ts` — 混合检索 (BM25 + Vector + Graph)
- `db-knowledge-graph.ts` — 图节点/边管理

✅ **6. 提取 walkDirectory 公共工具函数**
当前在 `api-server.ts`、`nightly-memory-archive.ts`、`project-knowledge-store.ts` 三处重复
→ 已提取到 `server/lib/fs-utils.ts`

✅ **7. 修复 scripts/dev-all.mjs 循环引用**
`dev-all.mjs` 内部调用 `npm run dev:all` 形成隐式循环
→ 已确认 `dev-all.mjs` 当前不存在自调用；`desktop-dev.mjs` 已改为直接通过 Node 启动 `scripts/dev-all.mjs`，避免依赖 `dev:all` npm alias

### P1 — 质量与稳定性

⬜ **8. 统一错误处理策略**
- ✅ 已引入 `Result<T, Error>` 类型；业务调用点迁移仍需继续推进
- ✅ 已新增数据库事务 helper；数据库操作迁移仍需继续批量推进
- ✅ API 响应增加 `error_code` 字段

✅ **9. FTS5 Schema 逻辑集中化**
已提取 `src/lib/db-fts5-helpers.ts`，统一处理运行时 FTS5 虚拟表建表与可用性检测

✅ **10. API 请求日志中间件**
已添加轻量自定义 Express 请求日志中间件，记录 method / path / status / duration，避免输出 query string 中的敏感信息

⬜ **11. 补充核心集成测试**
- 混合搜索管线端到端测试
- LangGraph runtime 流式集成测试
- Provider 兼容性 E2E
- Electron IPC 桥测试
- Query Router 完整路径测试

### P2 — 产品功能增强

⬜ **12. Memory Inspector 视图**
用户可直观看到记忆状态 (hot/warm/cold/long-term)、手动干预评分、调整晋升策略
- 新增 `MemoryView` 组件
- 显示每条记忆的来源、分数、层级、晋升状态
- 支持手动标记 "important / archive / delete"

⬜ **13. 证据反馈面板**
在回答底部显示引用的知识来源和支持度
- 显示每条检索结果的 source_type / supportLabel / matchedTerms
- 用户可标记 "有用 / 没用" 形成反馈闭环
- 反馈数据用于优化 RAG 检索权重

⬜ **14. RAG 权重可调体系**
将硬编码权重纳入 `config.json -> search.weights`：
- `lexicalWeight / vectorWeight / graphWeight`
- 按 source_type 差异化权重 (skill_doc vs project_doc)

⬜ **15. 记忆统一 RAG 索引**
全局记忆/热层/温层各走一套检索路径，未并入统一 memory RAG
→ 建立 `searchMemories(query, options)` 统一接口，复用文档搜索管线

⬜ **16. Session Summary 升级为 LLM 摘要**
当前为确定性摘要，质量有限
→ 增加可选 LLM 摘要模式，复用夜间归档同一模型管道

⬜ **17. Electron 能力扩展**
- 原生文件对话框 (打开/保存项目)
- 系统托盘 + 后台运行
- 全局快捷键 (快速唤醒)
- 原生通知 (记忆归档完成、夜间任务结果)
- Host shell 执行 (Phase 2, 可选开启)

⬜ **18. 可观测性增强**
- 搜索延迟指标 (BM25 / vector / graph 各阶段耗时)
- 记忆注入 token 统计
- 模型调用成功率/延迟
- 扩展现有 Runtime Diagnostics 面板

进度汇报（2026-04-14，架构优化第一次更新）:
- ✅ 已把三处重复的 `walkDirectory(directoryPath)` 收口到 `server/lib/fs-utils.ts`，保留原有递归遍历、返回文件路径、不内置排序/过滤、错误向上抛出的语义
- ✅ `server/api-server.ts`、`server/nightly-memory-archive.ts`、`server/project-knowledge-store.ts` 已改为复用同一个 helper，调用方仍各自负责 `.md` 过滤、相对路径转换和排序
- ✅ 已新增 `tests/fs-utils.test.ts` 覆盖嵌套目录递归与“只返回文件不返回目录”的基础行为，并通过相关 API / nightly / project knowledge 测试、`npm run lint` 与 `npm run build`

进度汇报（2026-04-14，架构优化第二次更新）:
- ✅ 已检查 `scripts/dev-all.mjs` 启动链路，当前文件只负责启动 `api-server` 与 `dev:web`，没有内部调用 `npm run dev:all`
- ✅ 已把 `scripts/desktop-dev.mjs` 从 `npm run dev:all` 改为直接执行 `node scripts/dev-all.mjs`，减少 npm alias 改动带来的隐式递归风险
- ✅ 已通过脚本语法检查与项目级 `npm run lint`、`npm run build`

进度汇报（2026-04-14，架构优化第三次更新）:
- ✅ 已给本地 `api-server` 增加轻量请求日志中间件，响应完成后输出 `[api] METHOD /path status durationMs`，用于后台排错和运行态观测
- ✅ 日志使用 `request.path` 而不是 `request.originalUrl`，不会记录 query string，避免 `authToken` 等敏感参数进入日志
- ✅ `createFlowAgentApiServer()` 已支持注入 logger，测试环境可静默或捕获日志；已补测试覆盖日志格式和 query 脱敏，并通过 `node --import tsx --test tests/agent-memory-api.test.ts`、`npm run lint`、`npm run build`

进度汇报（2026-04-14，架构优化第四次更新）:
- ✅ 已新增 `src/lib/db-fts5-helpers.ts`，集中提供 `createFts5Table / createFts5Tables / hasFts5Table`，并对内部 FTS5 table identifier 做最小校验
- ✅ `src/lib/db.ts` 的 `document_chunks_fts` 与 `src/lib/agent-workspace.ts` 的 `topic_title_fts / message_content_fts` 已统一通过 helper 建表，搜索 SQL 和索引写入逻辑保持原状
- ✅ 已补 `tests/db-fts5-helpers.test.ts` 覆盖建表 SQL、失败回退、sqlite_master 检测和非法 identifier，并通过 FTS/RAG、session runtime、`npm run lint` 与 `npm run build`

进度汇报（2026-04-14，架构优化第五次更新）:
- ✅ 已给 `api-server` 增加统一 `sendApiError()`，当前错误响应保持原有 `error` 文本，同时新增稳定 `error_code`
- ✅ 已覆盖鉴权、参数校验、config、model metadata、nightly archive、project knowledge、memory file 等现有 API 错误路径
- ✅ 已补测试覆盖 `AUTH_UNAUTHORIZED` 与 `MODEL_METADATA_INVALID_REQUEST`，并确认 query string 不进入请求日志；已通过 `node --import tsx --test tests/agent-memory-api.test.ts`、`npm run lint`、`npm run build`
- ⬜ 第 8 项剩余：业务调用点迁移到 `Result` 与数据库事务 helper 批量迁移仍未落地

进度汇报（2026-04-14，架构优化第六次更新）:
- ✅ 已新增 `src/lib/db-transaction.ts`，提供 `runDatabaseTransaction()`，统一 `BEGIN -> COMMIT` 与失败 `ROLLBACK -> rethrow` 语义
- ✅ 已先把 `src/lib/db.ts` 的 `addConversationMessages()` 迁移到事务 helper，作为后续批量替换其他手写事务的模板
- ✅ 已补 `tests/db-transaction.test.ts` 覆盖成功提交与失败回滚，并通过 `node --import tsx --test tests/local-rag-indexing.test.ts`、`npm run lint`、`npm run build`
- ⬜ 第 8 项剩余：业务调用点仍需逐步迁移到 `Result`；其余手写 DB 事务还需要逐步迁移到 helper

进度汇报（2026-04-14，架构优化第七次更新）:
- ✅ 已新增 `src/lib/result.ts`，提供 `Result<T, E> / Ok / Err / ok() / err() / isOk() / isErr()`，作为后续显式错误返回的公共类型基础
- ✅ 已补 `tests/result.test.ts` 覆盖 success / failure 构造和 type guard 行为，并通过 `node --import tsx --test tests/result.test.ts`、`npm run lint`、`npm run build`
- ⬜ 第 8 项剩余：业务调用点仍需逐步迁移到 `Result`；其余手写 DB 事务还需要继续迁移到 `runDatabaseTransaction()`

### P3 — 深层产品功能 (brainstorm 补充)

⬜ **19. Prompt Inspector 面板 (上下文窗口可视化)**
发送前显示 system prompt 构成：base prompt + 记忆 + skills + 工具的 token 占比
- 记忆注入清单：注入了哪些 long-term / hot / warm 条目，各占多少 token
- 当前 context window 使用率（还剩多少空间）
- 点击某条记忆可直接查看完整内容
- **最低开发成本，最高用户感知价值，直接支撑"可解释"叙事**

⬜ **20. Memory Timeline (记忆演变时间线)**
- 按时间轴展示记忆的诞生（写入 daily）、成长（晋升 warm/cold）、蜕变（晋升 MEMORY.md）、死亡（冷层删除）
- 配合过滤和搜索，用户可以手动撤销某次晋升或删除
- 直接强化"会成长、会遗忘"的产品叙事

⬜ **21. 代码库感知 RAG**
- 自动扫描 `src/` 下的 `.ts / .py / .go` 文件
- 提取函数签名、类定义、模块依赖关系，构建代码知识图谱
- 结合 AST 做更精准的分块（按函数/类边界切，而非固定字符数）
- 开发者场景刚需，但工程量较大

⬜ **22. 用户纠正学习**
- 识别纠正类意图（"不要这样做"/"下次用 X"）→ 生成结构化行为规则
- 写入 `MEMORY.md` 的 "Behavioral Rules" 区块
- 每次对话前作为 system prompt 硬性约束注入
- 设置页可看到所有已学习规则，手动编辑/删除
- **让记忆从"记录"进化到"行为控制"，是记忆价值的倍增器**

⬜ **23. 定时触发器 / 自动化**
- 每天早 8 点自动生成昨日会话摘要
- 每周日自动执行记忆归档和晋升
- 每次 git push 自动触发 code review agent
- 自定义 cron 表达式 + 触发任意 agent 操作
- 复用夜间归档的 scheduler 框架

⬜ **24. Agent 配置导出 / 分享**
- 一键打包 `config.json` + `memory/agents/<slug>/` + `skills/` 为 `.flowagent` 文件
- 支持从 `.flowagent` 文件导入创建新 agent
- 后续做社区 marketplace，分享高质量 agent 配置模板
- 降低新用户上手门槛，形成生态网络效应
