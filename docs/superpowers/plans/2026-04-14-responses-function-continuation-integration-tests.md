# Responses Function Continuation Integration Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Responses runtime 的 function calling continuation 补上核心集成测试，验证工具调用后的第二跳请求不会丢失。

**Architecture:** 只补测试。通过 mock `/responses` SSE 第一跳返回 `function_call`，断言 runtime 会执行本地 tool、发出 `tool_event`，并带着 `previous_response_id` 与 `function_call_output` 发起第二跳 `/responses` 请求。

**Tech Stack:** Node test runner、TypeScript、Fetch mock、ReadableStream SSE stub

---

### Task 1: Responses Continuation Test

**Files:**
- Create: `docs/superpowers/plans/2026-04-14-responses-function-continuation-integration-tests.md`
- Modify: `tests/provider-runtime-integration.test.ts`

- [ ] 写一个 function calling continuation 集成测试，覆盖第一跳 SSE function call、第二跳 continuation 请求、最终 assistant 输出。
- [ ] 运行相关单测，确认 `previous_response_id` 和 `function_call_output` 被正确发送。
