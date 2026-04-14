<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# FlowAgent AI

FlowAgent AI 是一个本地优先的智能代理工作空间，集成了智能体通道、基于本地 SQLite 的知识检索、LangGraph 运行时执行，以及创新的基于文件的代理记忆模型。

## 核心特性

### 🧠 智能记忆系统
- **分层记忆架构**: 实现长期记忆（全局记忆）和短期记忆（每日日志）
- **自动晋升机制**: 用户明确标记的重要信息会自动晋升为长期记忆
- **文件化存储**: 记忆以 Markdown 文件为真实来源，支持本地编辑
- **智能检索**: 支持热/温/冷三层记忆检索，按重要性和时效性分层管理

### 🔍 本地 RAG 引擎
- **混合检索**: 结合向量检索和关键词检索（BM25）
- **多模型支持**: 支持 text-embedding-v4 等多种嵌入模型
- **语义缓存**: 避免重复计算，提升检索效率
- **任务拆解**: 将复杂查询分解为多个子任务

### 💾 本地优先架构
- **离线可用**: 所有数据存储在本地，保护隐私
- **SQLite WASM**: 使用官方 SQLite WASM 实现本地存储
- **实时同步**: 记忆和知识库实时同步到本地数据库

### 🌐 知识库管理
- **自动同步**: 项目内的 Markdown 文档自动同步到知识库
- **动态索引**: 支持实时更新和重建索引
- **文档分块**: 智能文档解析和递归切分
- **Skills 命中**: 支持共享与 agent 私有 `SKILL.md` 的自动索引和上下文注入

## 快速开始

### 环境要求

- Node.js
- npm

### 安装和启动

安装依赖并启动 Web 应用：

```bash
npm install
npm run dev
```

`npm run dev` 现在会同时启动前端和本地 `api-server`。默认情况下：

- Vite 前端运行在 `http://127.0.0.1:3000`
- 本地 `api-server` 运行在 `http://127.0.0.1:3850`

如果你只想单独启动前端开发服务器，可以使用：

```bash
npm run dev:web
```

### Electron 桌面模式

当前已提供第一版 macOS Electron 桌面壳，仍复用现有 React/Vite renderer 与本地 `api-server` host bridge。

开发预览：

```bash
npm run desktop:preview
```

本地 unsigned `.app` 打包：

```bash
npm run desktop:build
```

打包产物默认位于 `release/mac-arm64/FlowAgent.app`。当前 Phase 1 行为：

- Electron 会自动启动本地 host bridge，不再需要用户手动运行 `npm run api-server`
- 开发态数据根目录默认仍是仓库根目录
- 打包态数据根目录默认是 `~/Library/Application Support/FlowAgent/workspace`
- `config.json`、`model-metadata.json`、`memory/agents/...` 继续作为文件真源
- host shell 权限默认关闭；终端页仍是 WebContainer 纯沙盒
- `api-server` 会在打包前预编译为 `dist-host/api-server.mjs`，packaged app 不再依赖 TS 源码或 `tsx` 来启动 host
- 当前 `.app` 未签名/未公证；Phase 1 仍暂时关闭 asar，后续再做 `asarUnpack` 与 host 二进制化优化

### 本地记忆 API 服务器

前端可以通过本地 API 服务器编辑项目记忆文件。从仓库根目录启动：

```bash
npm run api-server
```

默认监听端口为 `http://127.0.0.1:3850`。

可选环境变量：

- `FLOWAGENT_API_PORT`: 覆盖本地 API 端口
- `FLOWAGENT_PROJECT_ROOT`: 覆盖用于记忆文件解析的项目根目录
- `FLOWAGENT_API_TOKEN`: 在 API 请求上要求 `Authorization: Bearer <token>`

在设置 -> `API 服务器` 中：

- 启用本地 API 服务器开关
- 保持 `http://127.0.0.1:3850` 作为默认 `baseUrl`，或指向自定义服务器
- 如果配置了 `FLOWAGENT_API_TOKEN`，在 `authToken` 中放入相同令牌

## 配置存储机制

应用配置现在使用项目根目录的文件作为真源。

- 本地私有配置文件：`config.json`
- 仓库模板文件：`config.example.json`
- `config.json` 已加入 `.gitignore`，不会提交到 git

运行时规则：

- 前端优先通过本地 `api-server` 读取和写入 `config.json`
- 如果检测到旧浏览器配置且当前文件配置还是默认值，会自动迁移到 `config.json`
- 如果本地 host bridge 不可用，前端会回退到默认配置启动，但不会假装已经持久化保存成功

## 记忆存储机制

代理记忆现在使用 Markdown 文件作为唯一真实来源。

- **长期记忆**: `memory/agents/<agent-slug>/MEMORY.md`
- **每日短期记忆**: `memory/agents/<agent-slug>/daily/YYYY-MM-DD.md`
- **默认扫描范围**: 仅当前代理自己的记忆目录
- **跨代理扫描**: 仅在用户明确要求时启用

规则：

- Markdown 文件具有权威性
- SQLite 仅为可重建的索引和缓存层
- UI 编辑首先写入 Markdown，然后刷新当前代理的派生索引
- 通过重新扫描当前代理记忆文件可以恢复对应用之外的手动编辑

## Skills 存储机制

FlowAgent 现在支持两层 `SKILL.md` 技能源：

- 共享 skills：`skills/**/SKILL.md`
- agent 私有 skills：`memory/agents/<agent-slug>/skills/**/SKILL.md`

运行时规则：

- 应用启动后会优先通过本地 `api-server` 扫描共享 Markdown 文档和 `skills/**/SKILL.md`
- 共享 docs/skills 由本地 `api-server` 以 watcher + 事件流方式感知变化，前端会自动刷新索引
- 当前 agent 发送消息前，会补扫自己的私有 `skills/**/SKILL.md`
- 技能命中时，系统提示会优先注入当前 agent 私有 skills，再补共享 skills
- `search_knowledge_base` 工具也会返回 `skill_doc` 元数据，方便模型显式调用知识检索时识别技能来源

### 温冷层生命周期

- 原始每日记忆继续保留在 `memory/agents/<agent-slug>/daily/YYYY-MM-DD.md`
- 温层替身位于 `memory/agents/<agent-slug>/daily/YYYY-MM-DD.warm.md`
- 冷层替身位于 `memory/agents/<agent-slug>/daily/YYYY-MM-DD.cold.md`
- 热层（0-2 天）优先读取原始 daily 文件
- 温层（3-15 天）优先读取 `*.warm.md`，缺失时回退到原始 daily
- 冷层（15 天以上）优先读取 `*.cold.md`，缺失时再回退到 warm/source
- 设置页 `Memory` 分类可以手动触发“同步温冷层”，生成替身并刷新当前 agent 的派生索引
- 当前阶段原始 daily 文件不会删除，仍作为唯一真源保留
- 当前第一版冷层向量归档会为有效的 `*.cold.md` 写入独立 memory embedding 索引，并只在 Query Router 需要冷层时触发语义召回
- 本地 `api-server` 现在支持夜间自动归档调度，默认关闭，可在设置 -> `API 服务器` 中启用并配置每日执行时间
- 若夜间服务未运行，`api-server` 下次启动时会自动补跑错过的归档，并把状态持久化到项目内 `.flowagent/nightly-memory-archive-*.json`
- 夜间归档现支持可选的 LLM 重要性评分，复用当前活动模型为进入 warm/cold 的 daily 生成 `importance / promotionScore / retentionSuggestion / promoteSignals` 元数据；失败时自动回退规则评分
- 夜间归档现支持自动长期晋升：显式用户要求、重复出现的稳定结论、以及被模型判定为高抽象高可迁移的经验，会合并写入 `MEMORY.md` 的 auto-managed learned patterns 区块
- 记忆评分权重已进入 `config.json`：可按需调整 `compression / timeliness / connectivity / conflictResolution / abstraction / goldenLabel / transferability`

## 技术架构

### 记忆生命周期管理
- **热层** (0-2天): 完整文档内容，支持全文检索
- **温层** (3-15天): 摘要、元数据、关键词替身
- **冷层** (15天以上): 超精简摘要、关键词标签、时间索引

### 智能查询路由
- 根据问题的时间指向性智能选择检索层
- 明确旧时间查询（如具体日期、上个月、去年且已超过 15 天）会优先检索冷层与全局记忆
- 模糊时间或普通问题会先检索热层/温层/全局记忆，结果不足时再回退冷层

### 重要性评分系统
- LLM 自动为记忆内容打分（1-5分）
- 按分项权重聚合 `promotionScore`，再决定是否晋升长期记忆
- 评分维度包括：压缩率、时效性、关联度、冲突解决、经验抽象度、用户反馈黄金标签、多场景可迁移性
- 显式用户要求、重复结论、被验证的高迁移经验会优先进入长期记忆
- 低分信息（日常闲聊）执行自动压缩

运行时仍然基于现有的 LangGraph 栈在 [`src/lib/agent/runtime.ts`](src/lib/agent/runtime.ts)；记忆变化通过基于文件的派生记录馈送到运行时，而不是使用第二个代理框架。

## 开发计划

### 已完成
- ✅ 本地优先 RAG 基础设施
- ✅ 混合检索（关键词 + 向量）
- ✅ 分层记忆系统
- ✅ 记忆文件化存储
- ✅ 语义缓存
- ✅ 任务拆解层
- ✅ Query Router（第一版）
- ✅ 温层摘要替身
- ✅ 冷层向量归档（第一版）
- ✅ 夜间自动归档（api-server 调度 + 启动补跑）
- ✅ 配置迁移到项目级 `config.json`
- ✅ 夜间 LLM 重要性评分（保留为 surrogate 元数据，不自动改写 `MEMORY.md`）
- ✅ 加权长期晋升（显式要求 / 重复结论 / 高迁移经验 -> `MEMORY.md` auto block）

### 正在进行
- 🔄 统一 memory RAG 与长期驻留策略

### 计划中
- 📋 知识图谱（GraphRAG）
- 📋 高级 RAG 技术（Self-RAG、Corrective RAG）
- 📋 重排序和上下文压缩
- 📋 RAG 链路的可调权重体系（后续与 memory scoring 对齐）
- 📋 完整的技能系统集成

## 贡献

欢迎提交 Issue 和 Pull Request 来帮助改进 FlowAgent AI！

## 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。
