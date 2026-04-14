# DB Transaction Helper Follow-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 继续把 `src/lib/db.ts` 中短小、边界清晰的手写事务迁到 `runDatabaseTransaction()`，减少重复的 `BEGIN/COMMIT/ROLLBACK` 模板代码。

**Architecture:** 只迁移 3 个短函数：`createConversation()`、`addLaneToConversation()`、`saveAssistant()`。暂不动 `importWorkspaceData()`，因为它事务块大、涉及 seed/import 连锁行为，单独处理更稳。

**Tech Stack:** TypeScript、SQLite wasm、本地 Node test runner

---

### Task 1: Migrate Short Transaction Functions

**Files:**
- Create: `docs/superpowers/plans/2026-04-14-db-transaction-helper-followup.md`
- Modify: `src/lib/db.ts`

- [ ] 将 `createConversation()` 的手写事务迁到 `runDatabaseTransaction()`。
- [ ] 将 `addLaneToConversation()` 的手写事务迁到 `runDatabaseTransaction()`。
- [ ] 将 `saveAssistant()` 的手写事务迁到 `runDatabaseTransaction()`。
- [ ] 运行相关测试与类型检查，确认行为不变。
