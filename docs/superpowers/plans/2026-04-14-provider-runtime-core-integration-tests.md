# Provider Runtime Core Integration Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 provider protocol 的两条关键链路补上核心集成测试，验证 chat/responses 选择最终落到正确请求 endpoint 与 payload。

**Architecture:** 仅补测试，不先改生产逻辑。测试覆盖聊天 runtime 的 Responses 流式请求，以及 task graph compiler 的 chat/responses 分流请求，避免 protocol 配置回归时前端表现正常但底层实际走错接口。

**Tech Stack:** Node test runner、TypeScript、Fetch mock、ReadableStream SSE stub

---

### Task 1: Runtime Responses Request Test

**Files:**
- Create: `docs/superpowers/plans/2026-04-14-provider-runtime-core-integration-tests.md`
- Create: `tests/provider-runtime-integration.test.ts`

- [ ] 写一个 Responses runtime 集成测试，验证 `/responses` endpoint、`enable_thinking`、`tools` 和 `input` 序列化。
- [ ] 运行单测，确认能收到 `reasoning_delta`、`assistant_message` 和 usage。

### Task 2: Task Graph Compiler Provider Split Test

**Files:**
- Create: `tests/provider-runtime-integration.test.ts`

- [ ] 写一个 responses-compatible compiler 测试，验证请求落到 `/responses` 且使用 `text.format.json_schema`。
- [ ] 写一个 chat-compatible compiler 测试，验证请求落到 `/chat/completions` 且使用 `response_format.json_schema`。
- [ ] 运行单测，确认两条分流都通过。
