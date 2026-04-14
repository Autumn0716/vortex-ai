# API Request Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add lightweight request logging to the local Express API server for easier backend debugging.

**Architecture:** Add a small middleware in `server/api-server.ts` that logs one line on `response.finish`. It records method, path, response status, and elapsed time, while intentionally omitting query strings to avoid leaking tokens or API keys.

**Tech Stack:** Express middleware, Node test runner with `tsx`, existing API server tests.

---

### Task 1: Middleware

**Files:**
- Modify: `server/api-server.ts`

- [x] **Step 1: Add logger option**

Extend `FlowAgentApiServerOptions` with `logger?: Pick<Console, 'info' | 'warn' | 'error'>` so tests and Electron can provide their own logger later.

- [x] **Step 2: Add request logging middleware**

Add `applyRequestLogging(app, logger)` after CORS/auth and before routes. The middleware logs after response finish:

```text
[api] GET /health 200 12ms
```

Use `request.path`, not `request.originalUrl`, so query strings are not logged.

### Task 2: Tests And Record

**Files:**
- Modify: `tests/agent-memory-api.test.ts`
- Modify: `todo-list.md`

- [x] **Step 1: Add focused logging test**

Start the API server with a capture logger, call `/health`, and assert one log line includes method/path/status/duration.

- [x] **Step 2: Run targeted tests**

Run: `node --import tsx --test tests/agent-memory-api.test.ts`

- [x] **Step 3: Run project checks**

Run: `npm run lint`

Run: `npm run build`

- [x] **Step 4: Record and commit**

Mark todo item 10 as ✅ and commit as `feat: log local api requests`.
