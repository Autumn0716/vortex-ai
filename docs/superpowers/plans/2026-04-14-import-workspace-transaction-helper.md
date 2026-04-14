# Import Workspace Transaction Helper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `importWorkspaceData()` 迁到统一事务 helper，并补一条最小导入测试锁住基础行为。

**Architecture:** 这次不改导入语义，只把现有 `BEGIN/COMMIT/ROLLBACK` 包装为 `runDatabaseTransaction()`；另外新增一条测试，验证导入后 assistant、conversation 和 message 都能读回。

**Tech Stack:** TypeScript、SQLite wasm、Node test runner、localforage mock

---

### Task 1: Import Transaction Migration

**Files:**
- Create: `docs/superpowers/plans/2026-04-14-import-workspace-transaction-helper.md`
- Modify: `src/lib/db.ts`
- Create: `tests/db-workspace-import.test.ts`

- [ ] 将 `importWorkspaceData()` 的手写事务迁到 `runDatabaseTransaction()`。
- [ ] 补一条最小导入测试，覆盖 assistant / conversation / message 读回。
- [ ] 运行相关测试、类型检查和构建。
