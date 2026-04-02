# 2026-04-03 Qwen Official Responses Tooling

## Goal

基于阿里云百炼官方文档，为 Qwen 的 `OpenAI Responses API` 接入第一批官方能力，并保持现有 `chat.completions` 路径继续可用。

第一批范围：

- `enable_thinking`
- `web_search`
- `web_extractor`
- `code_interpreter`
- `structured output`

第二批预留：

- `web_search_image`
- `image_search`
- `file_search`
- `mcp`

## Constraints

- 配置模型服务时已经支持：
  - `OpenAI 兼容`
  - `OpenAI Responses 兼容`
  - `Anthropic 原生`
- `Responses` 只对配置为 `OpenAI Responses 兼容` 的 provider 生效
- 继续保留现有 LangGraph chat runtime
- 不修改用户现有主题配色，只增量扩展聊天输入区和会话运行时

## Plan

1. 增加会话级 Qwen Responses 运行选项
   - thinking toggle
   - builtin tool toggles
   - structured output editor

2. 将聊天输入区现有联网搜索入口扩展为“Responses 工具面板”
   - 对 Responses provider 显示官方内置工具
   - 对 chat provider 保留现有联网搜索 provider 选择

3. 扩展 `createAgentRuntime`
   - chat path: 继续 LangGraph + 本地工具
   - responses path: 支持
     - `enable_thinking`
     - `tools`
     - `text.format` / `response_format`
     - SSE 事件解析

4. 增加最小能力校验与错误提示
   - 非 Responses provider 不显示 Responses 专属能力
   - thinking + structured output 冲突时给前端提示并自动降级

5. 补测试与文档
   - provider compatibility
   - responses request payload building
   - UI capability gating
