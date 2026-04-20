# Memory File Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move agent memory persistence to Markdown files under `memory/agents/<agent-slug>/` while keeping SQLite as a rebuildable indexing and cache layer.

**Architecture:** Add a file-oriented memory store and scanner that treat `MEMORY.md` and `daily/*.md` as the source of truth. Layer a synchronizer on top that rebuilds derived SQLite memory/search state per agent, then switch runtime and Settings UI flows to read and write Markdown first while preserving the current theme. Agent-related runtime integration must continue to flow through the existing LangGraph-based runtime in `src/lib/agent/runtime.ts` instead of introducing a second agent framework.

**Tech Stack:** React 19, Vite, TypeScript, SQLite wasm, localforage, Markdown parsing/serialization helpers, existing Settings UI shell

---

### Task 1: Add the file-backed memory store and path helpers

**Files:**
- Create: `src/lib/agent-memory-files.ts`
- Test: `tests/agent-memory-files.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAgentMemoryPaths,
  parseMemoryMarkdown,
  serializeMemoryMarkdown,
} from '../src/lib/agent-memory-files';

test('buildAgentMemoryPaths resolves MEMORY.md and daily paths for an agent slug', () => {
  const paths = buildAgentMemoryPaths('vortex-core', '2026-04-01');
  assert.equal(paths.memoryFile, 'memory/agents/vortex-core/MEMORY.md');
  assert.equal(paths.dailyFile, 'memory/agents/vortex-core/daily/2026-04-01.md');
});

test('serializeMemoryMarkdown round-trips frontmatter and body', () => {
  const markdown = serializeMemoryMarkdown({
    frontmatter: { title: 'Long-term Memory', updatedAt: '2026-04-01T12:00:00.000Z' },
    body: '默认使用中文输出。',
  });
  const parsed = parseMemoryMarkdown(markdown);
  assert.equal(parsed.frontmatter.title, 'Long-term Memory');
  assert.equal(parsed.body, '默认使用中文输出。');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/agent-memory-files.test.ts`
Expected: FAIL with module-not-found for `src/lib/agent-memory-files.ts`

- [ ] **Step 3: Write minimal implementation**

```ts
export function buildAgentMemoryPaths(agentSlug: string, date: string) {
  return {
    baseDir: `memory/agents/${agentSlug}`,
    memoryFile: `memory/agents/${agentSlug}/MEMORY.md`,
    dailyDir: `memory/agents/${agentSlug}/daily`,
    dailyFile: `memory/agents/${agentSlug}/daily/${date}.md`,
  };
}

export function parseMemoryMarkdown(markdown: string) {
  // Parse optional frontmatter and return normalized body text.
}

export function serializeMemoryMarkdown(input: {
  frontmatter: Record<string, string | number | boolean>;
  body: string;
}) {
  // Emit stable frontmatter + markdown body.
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/agent-memory-files.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent-memory-files.ts tests/agent-memory-files.test.ts
git commit -m "feat: add agent memory file helpers"
```

### Task 2: Add scanning, migration, and derived SQLite sync

**Files:**
- Create: `src/lib/agent-memory-sync.ts`
- Modify: `src/lib/agent-workspace.ts`
- Modify: `src/lib/db.ts`
- Test: `tests/agent-memory-sync.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';

import { syncAgentMemoryFromFiles } from '../src/lib/agent-memory-sync';

test('syncAgentMemoryFromFiles upserts long-term and daily markdown into derived memory rows', async () => {
  const writes: string[] = [];
  const fileStore = {
    readMemoryFile: async () => '# Long-term\n\n默认使用中文输出。',
    listDailyFiles: async () => [{ path: 'memory/agents/vortex-core/daily/2026-04-01.md', content: '- [08:30] TODO 修复 bootstrap。' }],
  };
  const database = {
    run(sql: string) {
      writes.push(sql);
    },
    exec() {
      return [];
    },
  };

  await syncAgentMemoryFromFiles({
    agentId: 'agent_vortex_core',
    agentSlug: 'vortex-core',
    database,
    fileStore,
  });

  assert.ok(writes.some((sql) => sql.includes('INSERT') || sql.includes('UPDATE')));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/agent-memory-sync.test.ts`
Expected: FAIL with module-not-found for `src/lib/agent-memory-sync.ts`

- [ ] **Step 3: Write minimal implementation**

```ts
export async function syncAgentMemoryFromFiles(input: {
  agentId: string;
  agentSlug: string;
  database: Database;
  fileStore: AgentMemoryFileStore;
}) {
  // Read MEMORY.md and daily/*.md for the current agent.
  // Normalize them into derived memory records.
  // Replace or upsert derived SQLite rows for this agent only.
}

export async function migrateAgentMemoryToFiles(agent: AgentProfile) {
  // If MEMORY.md or daily files are missing, generate them from existing SQLite memory rows.
  // Never overwrite existing files.
}
```

- [ ] **Step 4: Wire startup sync into the existing workspace bootstrap path**

```ts
// In ensureAgentSchema / bootstrap flow:
// 1. resolve agent slug
// 2. migrate missing files if needed
// 3. sync current agent file-backed memory into derived SQLite rows
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --import tsx --test tests/agent-memory-sync.test.ts tests/agent-workspace-schema.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/agent-memory-sync.ts src/lib/agent-workspace.ts src/lib/db.ts tests/agent-memory-sync.test.ts
git commit -m "feat: sync agent memory from markdown files"
```

### Task 3: Switch runtime memory reads to file-backed data

**Files:**
- Modify: `src/lib/agent-workspace.ts`
- Modify: `src/lib/agent-memory-model.ts`
- Modify: `src/components/ChatInterface.tsx`
- Verify against: `src/lib/agent/runtime.ts`
- Test: `tests/knowledge-memory-model.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test('formatLayeredMemoryContext prefers file-backed current agent memory records', () => {
  const context = formatLayeredMemoryContext([
    {
      id: 'memory_file',
      title: 'MEMORY.md',
      content: '默认使用中文输出。',
      memoryScope: 'global',
      sourceType: 'manual',
      importanceScore: 5,
      updatedAt: '2026-04-01T12:00:00.000Z',
    },
  ]);

  assert.match(context, /Long-term memory/);
  assert.match(context, /默认使用中文输出/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/knowledge-memory-model.test.ts`
Expected: FAIL because runtime path still reads SQLite-only canonical records

- [ ] **Step 3: Update runtime loading**

```ts
export async function getAgentMemoryContext(
  agentId: string,
  options?: { includeRecentMemorySnapshot?: boolean },
) {
  // Read derived records produced from current-agent markdown sync.
  // Assemble long-term memory + recent snapshot + open loops.
}
```

- [ ] **Step 4: Update the chat runtime integration**

```ts
const memoryContext = configSnapshot.memory.includeGlobalMemory
  ? await getAgentMemoryContext(workspaceSnapshot.agent.id, {
      includeRecentMemorySnapshot: configSnapshot.memory.includeRecentMemorySnapshot,
    })
  : '';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --import tsx --test tests/knowledge-memory-model.test.ts tests/agent-config.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/agent-workspace.ts src/lib/agent-memory-model.ts src/components/ChatInterface.tsx tests/knowledge-memory-model.test.ts
git commit -m "feat: load runtime memory from file-backed records"
```

### Task 4: Add file-based memory editing to Settings and document the model

**Files:**
- Modify: `src/components/settings/SettingsView.tsx`
- Modify: `src/lib/agent/config.ts`
- Modify: `README.md`
- Modify: `todo-list.md`
- Modify: `docs/CHANGELOG.md`
- Test: `tests/agent-config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test('normalizeAgentConfig keeps the file-memory editing toggle fields', () => {
  const config = normalizeAgentConfig({
    memory: {
      includeGlobalMemory: true,
      includeRecentMemorySnapshot: true,
    },
  } as Partial<AgentConfig>);

  assert.equal(config.memory.includeRecentMemorySnapshot, true);
});
```

- [ ] **Step 2: Run test to verify it fails if config shape or Settings wiring is incomplete**

Run: `node --import tsx --test tests/agent-config.test.ts`
Expected: FAIL if config/UI wiring is missing

- [ ] **Step 3: Extend the existing Settings memory page without changing the theme**

```ts
// Add:
// - MEMORY.md editor card
// - daily file list + editor pane
// - save and rescan actions
// - sync status/error block
// Preserve current cards, spacing, colors, and shell.
```

- [ ] **Step 4: Document the storage model**

```md
## Memory Storage

- Long-term memory lives in `memory/agents/<agent-slug>/MEMORY.md`
- Daily memory lives in `memory/agents/<agent-slug>/daily/YYYY-MM-DD.md`
- Markdown files are the source of truth
- SQLite is only a rebuildable index/cache layer
```

- [ ] **Step 5: Update progress logs**

```md
进度汇报（2026-04-01，第五次更新）:
已切换到 agent 级 Markdown 记忆真源：长期记忆落到 `MEMORY.md`，短期记忆落到 `daily/YYYY-MM-DD.md`，SQLite 仅保留索引和缓存职责。
```

- [ ] **Step 6: Run verification**

Run: `node --import tsx --test tests/agent-config.test.ts && npm run lint && npm run build`
Expected: PASS, with existing chunk-size warnings only

- [ ] **Step 7: Commit**

```bash
git add src/components/settings/SettingsView.tsx src/lib/agent/config.ts README.md todo-list.md docs/CHANGELOG.md tests/agent-config.test.ts
git commit -m "feat: add file-based memory editing"
```

## Self-Review

### Spec Coverage

- Agent-scoped file layout: Task 1 and Task 2
- Markdown as source of truth: Task 2 and Task 3
- SQLite as derived index/cache: Task 2
- Startup scanning and reindexing: Task 2
- Frontend editing in existing Settings theme: Task 4
- Migration from current SQLite-backed memory: Task 2
- README documentation: Task 4

No spec gaps remain for the first implementation slice.

### Placeholder Scan

- No `TBD`, `TODO`, or unresolved implementation markers are left in the plan body.
- Each task names the concrete files to modify and concrete verification commands.

### Type Consistency

- Memory file helpers live in `src/lib/agent-memory-files.ts`
- Sync logic lives in `src/lib/agent-memory-sync.ts`
- Runtime prompt assembly stays in `src/lib/agent-workspace.ts` and `src/lib/agent-memory-model.ts`
- Settings wiring remains in `src/components/settings/SettingsView.tsx`

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-01-memory-file-source-implementation.md`. Two execution options:

1. Subagent-Driven (recommended) - I dispatch a fresh subagent per task, review between tasks, fast iteration

2. Inline Execution - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
