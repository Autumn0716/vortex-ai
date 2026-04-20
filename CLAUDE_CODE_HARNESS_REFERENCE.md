# Claude Code Harness Engineering 参考书

面向：Vortex / LangGraph 架构优化
日期：2026-04-03

## 1. 这份参考书是干什么的

这份文档不是为了“照抄 Claude Code”，而是为了提炼 Claude Code 设计里真正值得借鉴的部分，转成适合我们当前项目的 LangGraph 工程原则。

目标是：

- 取其精华，去其糟粕
- 不做表面模仿，做运行时结构对齐
- 让 Vortex 的 agent/runtime/memory/tool/skills/session 形成更稳定的 Harness

这里的 `Harness Engineering`，可以简单理解为：

> 不是只关心“模型提示词怎么写”，而是关心“模型如何被一套稳定的外部系统包起来，并持续、安全、可观测地完成任务”。

## 2. Claude Code 原生 12 阶段设计理念

根据 `learn-claude-code` 提供的循序渐进训练路线，可以把 Claude Code 风格的原生理念概括为 12 个逐步增强的阶段。每一阶段都只增加一种关键控制机制。

### s01. One loop & Bash is all you need

原文：

> one tool + one loop = an agent

含义：

- agent 的本质不是复杂框架
- 只要有一个工具调用能力和一个稳定循环，就已经形成 agent

对我们的启发：

- 主循环应尽量简单
- 不要一开始就把系统做成过度编排的大图

### s02. Adding a tool means adding one handler

原文：

> the loop stays the same; new tools register into the dispatch map

含义：

- 增加工具时，不应改坏主循环
- 新工具应以 handler / registry 的方式注册进调度表

对我们的启发：

- tool system 的扩展应该走注册表
- 不该每接一个工具就分叉 runtime 主逻辑

### s03. An agent without a plan drifts

原文：

> list the steps first, then execute; completion doubles

含义：

- 没有计划，agent 容易漂移
- planning 不是附属品，而是完成率提升的关键机制

对我们的启发：

- planning / todo / task object 必须继续强化
- 复杂任务不能只靠即时对话推进

### s04. Break big tasks down; each subtask gets a clean context

原文：

> subagents use independent messages[], keeping the main conversation clean

含义：

- 子代理的第一价值是上下文隔离
- 主会话不能无限吞并所有中间过程

对我们的启发：

- `Branch Topic` 方向正确
- 后续 subagent 应继续保持独立消息历史和紧凑 handoff

### s05. Load knowledge when you need it, not upfront

原文：

> inject via tool_result, not the system prompt

含义：

- 知识不应预加载到 system prompt
- 更合理的方式是按需检索，再通过工具结果回填

对我们的启发：

- skills / docs / RAG 的核心不是“常驻”
- 而是按需召回与注入

### s06. Context will fill up; you need a way to make room

原文：

> three-layer compression strategy for infinite sessions

含义：

- 长对话一定会撑满上下文
- 必须有压缩和腾挪机制

对我们的启发：

- session summary 是必须补齐的一环
- memory lifecycle 不能只做存储，还要承担上下文压缩职责

### s07. Break big goals into small tasks, order them, persist to disk

原文：

> a file-based task graph with dependencies, laying the foundation for multi-agent collaboration

含义：

- 任务必须显式化
- 任务之间应有依赖关系
- 任务图应具备持久化能力

对我们的启发：

- 未来不应只停留在 `topic list`
- 应逐步形成显式 task graph / board

### s08. Run slow operations in the background; the agent keeps thinking

原文：

> daemon threads run commands, inject notifications on completion

含义：

- 慢操作不应阻塞主循环
- 后台任务完成后再注入通知即可

对我们的启发：

- nightly archive、长检索、慢工具、批处理任务都应该后台化
- UI 要能承载异步完成通知

### s09. When the task is too big for one, delegate to teammates

原文：

> persistent teammates + async mailboxes

含义：

- 多 agent 不应只是一次性 spawn
- 更理想的是持久 teammate 和异步收件箱

对我们的启发：

- 后续多 agent 设计应有持久角色
- 不只是“临时再开一个模型实例”

### s10. Teammates need shared communication rules

原文：

> one request-response pattern drives all negotiation

含义：

- agent 间通信必须协议化
- 不能完全靠自由文本协商

对我们的启发：

- handoff schema
- request / response envelope
- tool/task result schema

这些都应继续结构化

### s11. Teammates scan the board and claim tasks themselves

原文：

> no need for the lead to assign each one

含义：

- 不应所有任务都由 leader 明确分配
- 更高级的自治来自任务看板与自主认领

对我们的启发：

- 未来 task board 可以成为多 agent 协作中心
- parent 不需要显式调度每一个子任务

### s12. Each works in its own directory, no interference

原文：

> tasks manage goals, worktrees manage directories, bound by ID

含义：

- 任务目标和物理工作目录应分离
- 每个任务要有独立工作空间，避免相互污染

对我们的启发：

- Electron / 本地宿主模式下，workspace isolation 很重要
- task 与 worktree / directory 的绑定是后续本地 agent 工程的关键

## 3. Claude Code 系思路里最值得借鉴的核心

基于 `learn-claude-code` 仓库的公开教学材料，以及 Claude Code 相关公开研究资料，可以归纳出下面几条真正重要的原则。

### 2.1 Model as Agent

最核心的一点不是复杂编排，而是承认：

- 模型本身就是 agent 的核心决策器
- 外部系统的职责是：
  - 给模型稳定上下文
  - 给模型可用工具
  - 给模型合适约束
  - 给模型可持续运行的状态

也就是说，Harness 的工作不是替模型“写死流程”，而是：

- 给它对的工作台
- 让它在这个工作台里高质量行动

这和我们当前系统是兼容的。LangGraph 应该做“状态机与约束层”，不应该过度替代模型决策。

### 2.2 真正的 agent 核心循环非常简单

`learn-claude-code` 公开教学材料给出的核心模式很清楚：

1. 模型读取消息和工具定义
2. 如果需要工具，就发起 tool call
3. 外部系统执行工具并回填结果
4. 模型继续，直到返回最终答复

这个循环本身并不复杂。复杂的是外侧 Harness：

- 消息如何裁剪
- 权限如何限制
- 子任务如何隔离
- skills 如何按需加载
- memory 如何分层
- 工具如何分类与观测

这意味着我们后续优化时，不能把注意力全放在“图里有多少节点、链路有多少层”，而要把重点放回：

- 工具层
- 状态层
- 会话层
- 上下文层
- 权限层

### 2.3 显式规划比隐式规划更稳

Claude Code 风格系统里，一个非常重要的点是：

- planning 不是完全隐藏的
- task / todo / subtask 往往是显式对象

这对我们当前系统的启发是：

- `Topic`
- `Branch Topic`
- `Quick Topic`
- 后续的子代理任务

都不应该只是一段消息，而应该是明确的运行单元。

也就是说：

- 会话是状态容器
- 任务是执行容器
- agent 是能力模板

这个方向我们已经开始做了，但还需要继续收口。

### 2.4 子代理不是“多开几个模型”，而是“隔离上下文的任务单元”

Claude Code 风格的 subagent 机制有一个非常关键的工程点：

- 子代理的价值不在于“并发”本身
- 而在于“上下文隔离”

这点对我们特别重要。

后续我们做 LangGraph 子代理时，应该坚持：

- parent 负责主任务
- child 负责局部子问题
- child 只继承必要上下文
- child 结果通过 compact handoff 回传

不能让所有子代理共享一整份历史对话，否则上下文会很快失控。

### 2.5 Skills 不是提示词碎片，而是按需加载的领域能力包

Claude Code / learn-claude-code 这条线里，`SKILL.md` 最值得借鉴的不是“又多了一份 markdown”，而是它代表：

- 可按需加载的领域知识
- 可复用的任务工作流
- 工具使用约束
- 领域最佳实践

对我们来说，skills 的正确定位应该是：

- 不是常驻塞满 prompt
- 而是通过检索按需注入
- 必要时成为 workflow hint
- 更进一步时成为 step-level policy

我们现在已经做到了：

- 共享 skills
- agent 私有 skills
- watcher + RAG 索引

后续需要继续的是：

- 更细粒度的 workflow 注入
- 和 tools / planner 的联动

### 2.6 Harness 的关键不是“会不会调工具”，而是“工具是否被正确约束”

Claude Code 风格系统的工具工程通常有几个共同点：

- 工具是少量高价值原子能力
- 参数模式稳定
- 权限边界清楚
- 调用结果可观察

这对我们意味着：

- 不要只追求“工具数量”
- 要追求：
  - 工具边界清晰
  - 输入输出稳定
  - 权限可裁剪
  - 调用日志可见

这也是为什么我们后面必须做统一 capability 模型。

### 2.7 上下文不是越多越好，而是越“可压缩、可回放、可路由”越好

Claude Code 风格 Harness 的真正强点，通常不是单次上下文特别大，而是：

- 会把上下文拆层
- 会做摘要
- 会保留近期原始消息
- 会让长期状态单独沉淀
- 会让任务结果以 compact form 回流

这和我们当前的目标高度一致：

- session short-term
- agent shared short-term
- long-term memory
- warm/cold surrogate
- Query Router

但我们现在还缺一块：

- 长对话 session summary

## 4. 我们应该借鉴什么，不该借鉴什么

### 应该借鉴的

1. Agent loop 保持简单  
不要为了“看起来高级”把主循环写成一堆隐式 side effect。

2. 状态对象显式化  
任务、会话、分支、工具调用、handoff 都应该是结构化对象。

3. 子任务隔离  
branch / subagent 必须是轻上下文继承，不是全文复制。

4. Skills 按需加载  
技能应进入检索层和 workflow 层，而不是永久膨胀主 prompt。

5. 权限能力显式化  
不同运行模式必须按 capability 裁剪工具和 UI。

6. 观测性  
必须能看到：
- 当前模型
- 当前 provider
- 当前协议模式
- 当前启用工具
- 当前检索证据
- 当前 memory 路由

### 不应该照搬的

1. 不应迷信“Claude Code 的具体实现细节”  
公开材料很多是教学化抽象，不适合逐字复刻。

2. 不应把一切都塞进单个系统 prompt  
这会让系统越来越脆。

3. 不应默认“多 agent 一定更强”  
多 agent 只有在任务边界清楚、handoff 紧凑、上下文隔离明确时才有价值。

4. 不应把本地桌面版和网页版混成一套权限模型  
这会让安全边界变形。

## 5. Vortex 对照 Claude Code 的结构映射

### 4.1 会话层

Claude Code 风格：

- 会话是执行容器
- 子任务可分支
- 结果可回流

Vortex 当前状态：

- 已有 `Topic`
- 已有 `Quick Topic`
- 已有 `Branch Topic`
- 已有 branch handoff

结论：

- 方向正确
- 需要继续强化 task-level orchestration

### 4.2 记忆层

Claude Code 风格可借鉴点：

- 长期状态与短期上下文分离
- 历史对话不能无限增长
- 重要结果应该沉淀成可复用状态

Vortex 当前状态：

- `MEMORY.md`
- `daily/*.md`
- `warm/cold` surrogate
- nightly scoring
- promotion

结论：

- memory lifecycle 基础已经足够好
- 下一步重点不该再无限加层，而应做：
  - session summary
  - memory routing 继续精炼
  - 全层 memory RAG 统一化

### 4.3 Skills 层

Claude Code 风格：

- 技能是领域能力包
- 需要时检索注入

Vortex 当前状态：

- 已支持共享 `skills/**/SKILL.md`
- 已支持 agent 私有 `skills/**/SKILL.md`
- 已做 watcher + 索引 + 命中注入

结论：

- 基础已对齐
- 下一步是从 prompt 注入升级到 workflow guidance

### 4.4 工具层

Claude Code 风格：

- 原子工具
- 明确权限
- 稳定 schema

Vortex 当前状态：

- 本地知识库工具
- 搜索工具
- WebContainer / 沙盒工具
- Qwen responses 内置工具
- MCP

结论：

- 工具数量已经够了
- 下一步不是继续堆，而是：
  - 能力门控
  - 运行模式裁剪
  - 调用日志与可视化

### 4.5 运行模式层

Claude Code 风格系统通常默认是本地宿主型 agent。

Vortex 的产品方向更复杂：

- Web 版：纯沙盒
- Electron 版：沙盒 + 宿主权限

因此我们必须比 Claude Code 更强调：

- capability gating
- hosted / local separation
- UI capability awareness

这其实是我们比“直接复刻 CC”更复杂、也更必须做好的地方。

## 6. 基于 LangGraph 的推荐 Harness 结构

## 6.1 核心原则

LangGraph 在这里的正确定位是：

- 不是替代 agent
- 而是管理 agent 的状态流

也就是说：

- 模型负责决策
- LangGraph 负责：
  - 状态推进
  - 工具回路
  - 分支控制
  - 中断/恢复
  - 节点级约束

## 6.2 推荐分层

建议后续结构保持为 6 层：

1. UI Layer  
负责会话、消息、设置、可观测性

2. Session Harness Layer  
负责：
- topic runtime
- branch runtime
- quick runtime
- session settings

3. Agent Orchestration Layer  
负责：
- LangGraph 主循环
- tool routing
- subagent spawn
- handoff

4. Context Layer  
负责：
- message window
- session summary
- memory context
- skill context
- retrieved evidence

5. Capability Layer  
负责：
- web / electron 模式裁剪
- tool availability
- host access boundary

6. Persistence Layer  
负责：
- topic messages
- memory markdown
- local/remote config
- RAG indexes

## 6.3 LangGraph 中该怎么落

后续推荐按这种模式继续：

- `StateGraph` 只维护最关键状态：
  - current messages
  - selected tools
  - active evidence
  - run mode
  - branch metadata

- 不要把所有 UI 状态塞进 graph state

- memory / skills / retrieval 不应直接耦合在 graph 节点内部
  - 应先在 harness 层组装
  - 再交给 graph

- subagent 不建议做成“graph 内共享大状态”
  - 更适合作为外层新 topic / child runtime

## 7. 结合当前项目，最值得优先优化的点

### 优先级 1：上下文压缩进入会话层

当前问题：

- 长对话主要还是 `historyWindow` 截断

建议：

- 增加 `session summary`
- 让较早消息变成结构化摘要
- 保留最近原始消息

### 优先级 2：daily source log 更细，nightly surrogate 更稳

当前状态：

- 已经开始增强 daily 粒度

建议继续：

- 把工具结果、附件、状态变化保留得更系统化
- 让 warm/cold 压缩更可靠

### 优先级 3：能力门控前置

必须尽快统一：

- Web mode
- Electron mode

并让这些能力决定：

- 是否显示本地记忆文件 UI
- 是否注册 shell 工具
- 是否允许本地 API server

### 优先级 4：skill 从 prompt 注入升级为 workflow policy

后续应让 skill 不只“加一段上下文”，而是影响：

- planner
- tool preference
- subagent spawning
- answer style / workflow constraints

### 优先级 5：对子代理做真正的任务工单化

branch 现在已经有了第一版。

下一步应该补：

- 明确 branch goal
- 明确 branch result type
- 明确 handoff schema
- 明确 parent merge policy

## 8. 一个适合我们自己的结论

我们不应该把 Vortex 做成“Claude Code 的网页翻版”。

更合理的目标是：

> 用 LangGraph 做状态骨架，用 Claude Code 风格 Harness 做 agent 工程原则，用我们自己的 memory/RAG/session 架构做差异化能力。

也就是说：

- Claude Code 给我们的是 Harness 思路
- LangGraph 给我们的是状态与控制骨架
- Vortex 自己真正的特色在：
  - layered memory
  - local/host dual mode
  - file-backed memory truth
  - session/branch runtime
  - hybrid + graph-assisted RAG

## 9. 后续执行建议

如果按这份参考书继续优化，推荐顺序是：

1. 完成 Web / Electron capability gating
2. 做 session summary
3. 继续增强 daily source log 和 nightly compression
4. 把 skill 接到 workflow/policy 层
5. 把 branch/subagent 变成更严格的 task unit
6. 再继续向更完整的 GraphRAG 收口

## 10. 参考来源

1. `shareAI-lab/learn-claude-code`
   https://github.com/shareAI-lab/learn-claude-code

2. `shareAI-lab/analysis_claude_code`
   https://github.com/shareAI-lab/analysis_claude_code

说明：

- 第一份材料更适合作为“教学化 Harness 原理”参考
- 第二份材料更适合作为“Claude Code 工程机制研究”参考
- 我们后续应把它们当成启发，而不是当成一比一复刻目标
