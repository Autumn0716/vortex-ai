# API Error Codes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add stable `error_code` fields to local API error responses.

**Architecture:** Add a tiny `sendApiError()` helper in `server/api-server.ts` and route all current API error responses through it. Keep existing `error` message text for backward compatibility.

**Tech Stack:** Express, TypeScript, Node test runner with `tsx`.

---

### Task 1: Error Response Helper

**Files:**
- Modify: `server/api-server.ts`

- [x] **Step 1: Add helper**

Implement `sendApiError(response, status, errorCode, message)`.

- [x] **Step 2: Replace current API error responses**

Replace `{ error }` response bodies with `{ error, error_code }` while preserving HTTP status codes and existing messages.

### Task 2: Tests And Record

**Files:**
- Modify: `tests/agent-memory-api.test.ts`
- Modify: `todo-list.md`

- [x] **Step 1: Add error-code assertions**

Verify unauthorized and validation errors include stable `error_code`.

- [x] **Step 2: Run targeted tests**

Run: `node --import tsx --test tests/agent-memory-api.test.ts`

- [x] **Step 3: Run project checks**

Run: `npm run lint`

Run: `npm run build`

- [x] **Step 4: Record and commit**

Record partial progress under item 8 and commit as `feat: add api error codes`.
