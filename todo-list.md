# Vortex TODO Summary

更新时间：2026-04-20

## 状态标记

- `✅` 已完成
- `⬜` 待做
- `⏸` 暂缓

## 当前版本已完成

### 核心架构

- ✅ 本地优先 React/Vite Web 应用。
- ✅ Electron macOS 桌面壳，内置本地 API server host bridge。
- ✅ 项目级 `config.json` 私有配置和 `config.example.json` 模板。
- ✅ SQLite WASM 本地存储、FTS5、缓存、审计、token usage 表。
- ✅ `agent-workspace.ts` 和 `db.ts` 已完成主要拆分，降低大文件复杂度。

### Agent 与会话

- ✅ 会话级 Agent 实例：topic/session 隔离模型、上下文、工具和运行状态。
- ✅ Quick Chat 模式：轻量对话不强制启用 agent memory/tools。
- ✅ LangGraph runtime：流式输出、reasoning、tool event、Responses API、Function Calling。
- ✅ 重新生成、复制、删除、停止流式输出、消息 token 统计等基础交互。

### 记忆系统

- ✅ Markdown 文件为唯一真源：`MEMORY.md`、`daily/*.md`、`corrections.md`、`reflections.md`。
- ✅ 热/温/冷三层记忆生命周期。
- ✅ `*.warm.md` / `*.cold.md` 摘要替身。
- ✅ 冷层向量归档与冷层语义召回。
- ✅ 可配置保留窗口、冷层容量、protected topics。
- ✅ 夜间归档、每周归档、每日摘要、长期记忆晋升。
- ✅ LLM 重要性评分与规则回退。
- ✅ 用户纠正学习和执行反思 bootstrap 文件。
- ✅ Memory Inspector 和 Memory Timeline。

### RAG 与知识库

- ✅ 本地知识库索引与混合检索。
- ✅ BM25 / vector / graph 权重可调。
- ✅ Corrective retrieval、query rewrite、cross-lingual alias、graph two-hop path evidence。
- ✅ Evidence 面板和有用/没用反馈。
- ✅ 统一 memory RAG 检索入口。
- ✅ 代码库感知 RAG：已支持项目代码摘要索引。
- ✅ 知识库质量评分：新鲜度、反馈、完整性、检索命中，影响排序。
- ✅ Prompt Inspector：可查看实际 prompt 组成和上下文占比。

### Workflow / 多代理

- ✅ 自然语言任务编译为持久化 task graph。
- ✅ Planner / Dispatcher / Worker / Reviewer 结构。
- ✅ Worker branch 自动创建、handoff、retry。
- ✅ Review-ready rollup 和 reviewer branch 自动创建。
- ✅ 后台 worker 执行，支持受限并发、串行落库、父 topic 批次汇总。
- ✅ Agent skills：共享 `skills/**/SKILL.md` 与 agent 私有 skills。

### 自动化与可观测性

- ✅ Automation registry：手动触发和状态查看。
- ✅ Daily summary、nightly archive、weekly archive、git pre-push code review。
- ✅ 参数化 `agent_task` 自动化，写入 agent daily 任务队列。
- ✅ Audit Viewer：工具、记忆、配置变更主链路审计。
- ✅ Usage Panel：topic/model/time 维度 token 与费用统计。
- ✅ Runtime diagnostics：Electron host、API server、模型调用可靠性。

### 发布与桌面

- ✅ `desktop:build` 可生成 unsigned macOS app。
- ✅ `asar` 打包已启用，host bridge 预编译为 `dist-host/api-server.mjs`。
- ✅ Electron preload 能力桥、原生打开/保存对话框、托盘、通知、快捷键。
- ✅ README 已精简为 GitHub 入口说明。

## 当前剩余待办

### P1

- ⏸ macOS 签名与公证：等发布阶段再做。

### P2

- ⬜ 27. 多格式文档索引
- ⬜ PDF 解析和索引。
- ⬜ CSV / Excel 表结构索引。
- ⬜ URL 网页抓取和定期刷新。
- ⬜ SQL schema / 数据库结构索引。
- ⬜ KnowledgePanel 多格式上传入口。

- ⬜ 29. 云端同步
- ⬜ 端到端加密同步。
- ⬜ 多设备冲突解决。
- ⬜ 版本历史和回滚。
- ⬜ 只同步数据，不做中心化 AI 推理。

- ⬜ 30. Agent 行为审计日志细化
- ⬜ server 侧配置写盘审计。
- ⬜ 记忆晋升细项审计。
- ⬜ 更完整的工具参数和结果摘要。

- ⬜ 31. Token 消耗统计增强
- ⬜ 月度预算上限。
- ⬜ 超限告警。
- ⬜ 按 tool 维度拆分 token / 成本。

## 发布前检查

- ✅ `npm run lint`
- ✅ `npm run build`
- ✅ `npm run desktop:build`
- ⬜ 创建 GitHub release tag。
- ⬜ 如需分发给普通 macOS 用户，完成签名与公证。
