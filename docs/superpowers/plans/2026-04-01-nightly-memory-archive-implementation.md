# Nightly Memory Archive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an API-server-hosted nightly memory archive scheduler that runs lifecycle compression automatically at night, catches up on missed runs at startup, and exposes minimal status/config controls in the existing settings UI.

**Architecture:** Add a focused server-side scheduler module that stores config/state in `.vortex/`, runs file-backed lifecycle sync for each agent directory under `memory/agents`, and exposes status/config through API-server endpoints. The browser keeps its existing local SQLite sync path and will ingest the updated files on normal rescan/startup.

**Tech Stack:** TypeScript, Node/Express API server, filesystem-backed scheduler state, React 19 settings UI, existing file-backed memory lifecycle, Node test runner with `tsx`

---

### Task 1: Build the nightly scheduler core and state-file helpers

**Files:**
- Create: `server/nightly-memory-archive.ts`
- Test: `tests/nightly-memory-archive.test.ts`

- [ ] **Step 1: Write the failing scheduler tests**

```ts
test('shouldRunNightlyCatchup returns true when the last scheduled run was missed', () => {
  assert.equal(
    shouldRunNightlyCatchup({
      now: '2026-04-02T10:00:00.000Z',
      scheduleTime: '03:00',
      lastSuccessfulRunAt: '2026-04-01T02:00:00.000Z',
    }),
    true,
  );
});

test('resolveNextNightlyRunAt returns the next local scheduled timestamp', () => {
  assert.equal(
    resolveNextNightlyRunAt({
      now: '2026-04-02T10:00:00.000Z',
      scheduleTime: '03:00',
    }).includes('2026-04-03'),
    true,
  );
});

test('readNightlyArchiveState returns defaults when the state file does not exist', async () => {
  const state = await readNightlyArchiveState('/tmp/project');
  assert.equal(state.lastSuccessfulRunAt, null);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import tsx --test tests/nightly-memory-archive.test.ts`
Expected: FAIL because the scheduler module does not exist yet

- [ ] **Step 3: Implement the scheduler primitives**

```ts
// server/nightly-memory-archive.ts
export interface NightlyArchiveSettings {
  enabled: boolean;
  time: string; // HH:MM
}

export interface NightlyArchiveState {
  lastSuccessfulRunAt: string | null;
  lastSuccessfulRunDate: string | null;
  lastAttemptedRunAt: string | null;
  lastRunSummary: { processedAgents: number; failedAgents: number; failures: string[] } | null;
}

export function normalizeNightlyArchiveSettings(value?: Partial<NightlyArchiveSettings>): NightlyArchiveSettings {
  return { enabled: value?.enabled ?? false, time: validateNightlyArchiveTime(value?.time ?? '03:00') };
}

export function shouldRunNightlyCatchup(...) { ... }
export function resolveNextNightlyRunAt(...) { ... }
export async function readNightlyArchiveState(rootDir: string) { ... }
export async function writeNightlyArchiveState(rootDir: string, state: NightlyArchiveState) { ... }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --import tsx --test tests/nightly-memory-archive.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/nightly-memory-archive.ts tests/nightly-memory-archive.test.ts
git commit -m "feat: add nightly archive scheduler core"
```

### Task 2: Integrate the scheduler into the API server and expose config/status endpoints

**Files:**
- Modify: `server/api-server.ts`
- Modify: `tests/agent-memory-api.test.ts`
- Modify: `tests/agent-memory-lifecycle.test.ts`

- [ ] **Step 1: Write the failing integration tests**

```ts
test('API server health includes nightly archive status', async () => {
  // start server
  // expect /health payload to include scheduler status/settings
});

test('API server can read and write nightly archive settings', async () => {
  // PUT settings via API
  // GET health or settings endpoint
  // expect persisted values
});

test('startup catch-up runs lifecycle sync once when the previous nightly window was missed', async () => {
  // seed memory files + stale state file
  // start server
  // expect warm/cold surrogates generated on boot
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
- `node --import tsx --test tests/agent-memory-api.test.ts`
- `node --import tsx --test tests/agent-memory-lifecycle.test.ts`

Expected: FAIL because the server has no nightly archive endpoints or scheduler integration yet

- [ ] **Step 3: Implement server integration**

```ts
// server/api-server.ts
const scheduler = createNightlyMemoryArchiveScheduler({
  rootDir,
  listAgentSlugs: async () => listAgentMemoryDirectories(rootDir),
  createFileStore: () => createFilesystemAgentMemoryFileStore(rootDir),
});

await scheduler.start();

app.get('/api/nightly-archive', async (_request, response) => {
  response.json(await scheduler.getStatus());
});

app.put('/api/nightly-archive', async (request, response) => {
  const next = await scheduler.updateSettings(request.body);
  response.json(next);
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
- `node --import tsx --test tests/agent-memory-api.test.ts`
- `node --import tsx --test tests/agent-memory-lifecycle.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/api-server.ts tests/agent-memory-api.test.ts tests/agent-memory-lifecycle.test.ts
git commit -m "feat: schedule nightly memory archive in api server"
```

### Task 3: Add API client helpers and settings UI controls

**Files:**
- Modify: `src/lib/agent-memory-api.ts`
- Modify: `src/components/settings/SettingsView.tsx`

- [ ] **Step 1: Write the failing UI/API tests or state assertions**

```ts
// if no dedicated UI test harness exists, add focused helper tests for API payload normalization
test('getNightlyArchiveStatus reads server scheduler settings and state', async () => {
  // mock API response
});
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `node --import tsx --test tests/agent-memory-api.test.ts`
Expected: FAIL because the client helper and UI wiring do not exist yet

- [ ] **Step 3: Implement API helpers and UI**

```ts
// src/lib/agent-memory-api.ts
export interface NightlyArchiveStatus { ... }
export async function getNightlyArchiveStatus(settings: ApiServerSettings) { ... }
export async function saveNightlyArchiveSettings(settings: ApiServerSettings, value: { enabled: boolean; time: string }) { ... }

// src/components/settings/SettingsView.tsx
// add a SectionCard in the existing API or Memory category:
// - toggle: 启用夜间自动归档
// - input: 归档时间 HH:MM
// - status text: 最近一次成功执行 / 失败摘要
// - save action writes to server via API helper
```

- [ ] **Step 4: Run the focused tests to verify they pass**

Run: `node --import tsx --test tests/agent-memory-api.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent-memory-api.ts src/components/settings/SettingsView.tsx
git commit -m "feat: add nightly archive settings controls"
```

### Task 4: Record progress and run end-to-end verification

**Files:**
- Modify: `README.md`
- Modify: `docs/CHANGELOG.md`
- Modify: `todo-list.md`

- [ ] **Step 1: Update docs**

```md
- README: document that nightly archive runs inside api-server and supports startup catch-up
- CHANGELOG: record scheduler, catch-up behavior, and settings support
- todo-list: append a dated progress update under memory lifecycle
```

- [ ] **Step 2: Run verification**

Run:
- `node --import tsx --test tests/nightly-memory-archive.test.ts`
- `node --import tsx --test tests/agent-memory-api.test.ts`
- `node --import tsx --test tests/agent-memory-lifecycle.test.ts`
- `npm run lint`

Expected: PASS

- [ ] **Step 3: Verify dev server still boots**

Run: `npm run dev`
Expected: Vite starts successfully on port `3000`

- [ ] **Step 4: Commit docs**

```bash
git add README.md docs/CHANGELOG.md todo-list.md
git commit -m "docs: record nightly memory archive"
```
