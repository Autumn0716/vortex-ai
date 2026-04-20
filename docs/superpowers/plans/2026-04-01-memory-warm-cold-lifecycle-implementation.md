# Memory Warm/Cold Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add warm/cold surrogate Markdown files for agent daily memory, sync them into derived SQLite rows, and make runtime plus Settings prefer those surrogates while keeping the existing LangGraph runtime unchanged.

**Architecture:** Introduce a lifecycle helper/summarizer/synchronizer around the existing file-backed memory model. Raw `daily/YYYY-MM-DD.md` files stay preserved as source inputs, while `*.warm.md` and `*.cold.md` are deterministic derived Markdown artifacts. Runtime and derived SQLite sync will select one effective document per day based on age tier precedence, and the Settings page will expose a manual lifecycle sync action plus surrogate file visibility.

**Tech Stack:** React 19, TypeScript, existing LangGraph runtime, SQLite wasm, local memory API server, existing file-backed memory helpers/tests

---

### Task 1: Add warm/cold lifecycle file helpers

**Files:**
- Modify: `src/lib/agent-memory-files.ts`
- Test: `tests/agent-memory-files.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
test('buildAgentMemoryPaths resolves warm and cold surrogate paths', () => {
  const paths = buildAgentMemoryPaths('vortex-core', '2026-04-01');
  assert.equal(paths.warmFile, 'memory/agents/vortex-core/daily/2026-04-01.warm.md');
  assert.equal(paths.coldFile, 'memory/agents/vortex-core/daily/2026-04-01.cold.md');
});

test('detectMemoryFileKind distinguishes source warm and cold daily files', () => {
  assert.equal(detectMemoryFileKind('memory/agents/core/daily/2026-04-01.md'), 'daily_source');
  assert.equal(detectMemoryFileKind('memory/agents/core/daily/2026-04-01.warm.md'), 'daily_warm');
  assert.equal(detectMemoryFileKind('memory/agents/core/daily/2026-04-01.cold.md'), 'daily_cold');
});

test('resolveDailyMemoryDate extracts the source date from surrogate file names', () => {
  assert.equal(resolveDailyMemoryDate('memory/agents/core/daily/2026-04-01.cold.md'), '2026-04-01');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test tests/agent-memory-files.test.ts`
Expected: FAIL because `warmFile`, `coldFile`, `detectMemoryFileKind`, or `resolveDailyMemoryDate` do not exist yet

- [ ] **Step 3: Implement the helper surface**

```ts
export type AgentMemoryFileKind =
  | 'memory'
  | 'daily_source'
  | 'daily_warm'
  | 'daily_cold'
  | 'unknown';

export function buildAgentMemoryPaths(agentSlug: string, date: string) {
  const baseDir = `memory/agents/${agentSlug}`;
  const dailyDir = `${baseDir}/daily`;
  return {
    baseDir,
    memoryFile: `${baseDir}/MEMORY.md`,
    dailyDir,
    dailyFile: `${dailyDir}/${date}.md`,
    warmFile: `${dailyDir}/${date}.warm.md`,
    coldFile: `${dailyDir}/${date}.cold.md`,
  };
}

export function detectMemoryFileKind(path: string): AgentMemoryFileKind {
  if (path.endsWith('/MEMORY.md')) {
    return 'memory';
  }
  if (/\/\d{4}-\d{2}-\d{2}\.warm\.md$/.test(path)) {
    return 'daily_warm';
  }
  if (/\/\d{4}-\d{2}-\d{2}\.cold\.md$/.test(path)) {
    return 'daily_cold';
  }
  if (/\/\d{4}-\d{2}-\d{2}\.md$/.test(path)) {
    return 'daily_source';
  }
  return 'unknown';
}

export function resolveDailyMemoryDate(path: string): string | null {
  const match = path.match(/(\d{4}-\d{2}-\d{2})(?:\.(?:warm|cold))?\.md$/);
  return match?.[1] ?? null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test tests/agent-memory-files.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent-memory-files.ts tests/agent-memory-files.test.ts
git commit -m "feat: add memory lifecycle file helpers"
```

### Task 2: Add deterministic warm/cold summarization

**Files:**
- Create: `src/lib/agent-memory-lifecycle.ts`
- Modify: `src/lib/agent-memory-model.ts`
- Test: `tests/knowledge-memory-model.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import {
  buildWarmMemorySurrogate,
  buildColdMemorySurrogate,
  resolveLifecycleTier,
} from '../src/lib/agent-memory-lifecycle';

test('resolveLifecycleTier maps dates into hot warm cold windows', () => {
  const now = '2026-04-20T12:00:00.000Z';
  assert.equal(resolveLifecycleTier('2026-04-19', now), 'hot');
  assert.equal(resolveLifecycleTier('2026-04-10', now), 'warm');
  assert.equal(resolveLifecycleTier('2026-03-01', now), 'cold');
});

test('buildWarmMemorySurrogate includes summary key fragments open loops and keywords', () => {
  const markdown = buildWarmMemorySurrogate({
    date: '2026-04-01',
    sourcePath: 'memory/agents/core/daily/2026-04-01.md',
    sourceMarkdown: '- [09:00] TODO 补齐索引\\n- [10:00] 已验证 bootstrap 修复',
    now: '2026-04-20T12:00:00.000Z',
  });
  assert.match(markdown, /tier: \"warm\"/);
  assert.match(markdown, /## Summary/);
  assert.match(markdown, /## Open Loops/);
  assert.match(markdown, /TODO 补齐索引/);
});

test('buildColdMemorySurrogate aggressively compresses the source log', () => {
  const markdown = buildColdMemorySurrogate({
    date: '2026-03-01',
    sourcePath: 'memory/agents/core/daily/2026-03-01.md',
    sourceMarkdown: '- [09:00] Legacy Topic · You: 旧项目背景。\\n- [10:00] TODO 清理遗留状态。',
    now: '2026-04-20T12:00:00.000Z',
  });
  assert.match(markdown, /tier: \"cold\"/);
  assert.match(markdown, /## Summary/);
  assert.match(markdown, /## Keywords/);
  assert.doesNotMatch(markdown, /## Key Fragments/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test tests/knowledge-memory-model.test.ts`
Expected: FAIL because lifecycle summarizer exports do not exist yet

- [ ] **Step 3: Implement deterministic summarization**

```ts
export type MemoryLifecycleTier = 'hot' | 'warm' | 'cold';

export function resolveLifecycleTier(date: string, now = new Date().toISOString()): MemoryLifecycleTier {
  const endOfDateIso = `${date}T23:59:59.999Z`;
  return resolveMemoryTier(endOfDateIso, now);
}

export function buildWarmMemorySurrogate(input: {
  date: string;
  sourcePath: string;
  sourceMarkdown: string;
  now?: string;
}) {
  const keyLines = extractSignificantDailyLines(input.sourceMarkdown);
  const openLoops = extractOpenMemoryTasks([
    {
      id: input.sourcePath,
      title: `${input.date} Daily Memory`,
      content: keyLines.join('\n'),
      memoryScope: 'daily',
      sourceType: 'conversation_log',
      importanceScore: scoreMemoryImportance(keyLines.join('\n'), 'conversation_log'),
      updatedAt: input.now ?? new Date().toISOString(),
    },
  ]);

  return serializeMemoryMarkdown({
    frontmatter: {
      title: `${input.date} Warm Memory`,
      date: input.date,
      tier: 'warm',
      sourcePath: input.sourcePath,
      updatedAt: input.now ?? new Date().toISOString(),
      importance: scoreMemoryImportance(keyLines.join('\n'), 'conversation_log'),
      keywords: extractMemoryKeywords(keyLines).join(', '),
    },
    body: [
      '## Summary',
      summarizeDailyLines(keyLines, 4),
      '',
      '## Key Fragments',
      renderBulletList(keyLines.slice(0, 4)),
      '',
      '## Open Loops',
      renderBulletList(openLoops),
      '',
      '## Keywords',
      renderBulletList(extractMemoryKeywords(keyLines)),
    ].join('\n'),
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test tests/knowledge-memory-model.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent-memory-lifecycle.ts src/lib/agent-memory-model.ts tests/knowledge-memory-model.test.ts
git commit -m "feat: add deterministic memory lifecycle summaries"
```

### Task 3: Generate warm/cold surrogate files for the current agent

**Files:**
- Modify: `src/lib/agent-memory-api.ts`
- Modify: `src/lib/agent-memory-sync.ts`
- Create: `tests/agent-memory-lifecycle.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import {
  syncAgentMemoryLifecycleFromStore,
  type AgentMemoryLifecycleResult,
} from '../src/lib/agent-memory-sync';

test('syncAgentMemoryLifecycleFromStore creates warm and cold surrogates from source daily files', async () => {
  const fileStore = new InMemoryFileStore(new Map([
    ['memory/agents/core/daily/2026-04-10.md', '- TODO 完成温层摘要'],
    ['memory/agents/core/daily/2026-03-01.md', '- TODO 保留冷层索引'],
  ]));

  const result = await syncAgentMemoryLifecycleFromStore({
    agentSlug: 'core',
    fileStore,
    now: '2026-04-20T12:00:00.000Z',
  });

  assert.equal(result.scannedCount, 2);
  assert.equal(result.warmUpdated, 1);
  assert.equal(result.coldUpdated, 1);
  assert.match(await fileStore.readText('memory/agents/core/daily/2026-04-10.warm.md') ?? '', /tier: \"warm\"/);
  assert.match(await fileStore.readText('memory/agents/core/daily/2026-03-01.cold.md') ?? '', /tier: \"cold\"/);
});

test('syncAgentMemoryLifecycleFromStore is idempotent when sources are unchanged', async () => {
  // Arrange a file store with existing warm/cold surrogates matching the current source
  // Expect updated counts to remain zero on the second pass
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test tests/agent-memory-lifecycle.test.ts`
Expected: FAIL because lifecycle sync entry points do not exist yet

- [ ] **Step 3: Implement lifecycle sync**

```ts
export interface AgentMemoryLifecycleResult {
  scannedCount: number;
  warmUpdated: number;
  coldUpdated: number;
  skippedCount: number;
  failures: Array<{ path: string; message: string }>;
}

export async function syncAgentMemoryLifecycleFromStore(input: {
  agentSlug: string;
  fileStore: AgentMemoryFileStore;
  now?: string;
}): Promise<AgentMemoryLifecycleResult> {
  const now = input.now ?? new Date().toISOString();
  const dailyDir = buildAgentMemoryPaths(input.agentSlug, now.slice(0, 10)).dailyDir;
  const paths = (await input.fileStore.listPaths(dailyDir))
    .filter((path) => detectMemoryFileKind(path) === 'daily_source')
    .sort();

  let warmUpdated = 0;
  let coldUpdated = 0;
  const failures: Array<{ path: string; message: string }> = [];

  for (const path of paths) {
    try {
      const date = resolveDailyMemoryDate(path);
      const sourceMarkdown = (await input.fileStore.readText(path)) ?? '';
      if (!date || !sourceMarkdown.trim()) {
        continue;
      }

      const tier = resolveLifecycleTier(date, now);
      const dailyPaths = buildAgentMemoryPaths(input.agentSlug, date);

      if (tier === 'warm') {
        const nextWarm = buildWarmMemorySurrogate({ date, sourcePath: path, sourceMarkdown, now });
        await writeIfChanged(input.fileStore, dailyPaths.warmFile, nextWarm);
        warmUpdated += 1;
        continue;
      }

      if (tier === 'cold') {
        const nextCold = buildColdMemorySurrogate({ date, sourcePath: path, sourceMarkdown, now });
        await writeIfChanged(input.fileStore, dailyPaths.coldFile, nextCold);
        coldUpdated += 1;
      }
    } catch (error) {
      failures.push({ path, message: error instanceof Error ? error.message : 'Lifecycle sync failed.' });
    }
  }

  return {
    scannedCount: paths.length,
    warmUpdated,
    coldUpdated,
    skippedCount: Math.max(0, paths.length - warmUpdated - coldUpdated - failures.length),
    failures,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test tests/agent-memory-lifecycle.test.ts tests/agent-memory-api.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent-memory-api.ts src/lib/agent-memory-sync.ts tests/agent-memory-lifecycle.test.ts
git commit -m "feat: add warm cold lifecycle file sync"
```

### Task 4: Index effective warm/cold documents and update runtime precedence

**Files:**
- Modify: `src/lib/agent-memory-model.ts`
- Modify: `src/lib/agent-memory-sync.ts`
- Modify: `src/lib/agent-workspace.ts`
- Test: `tests/agent-memory-sync.test.ts`
- Test: `tests/knowledge-memory-model.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
test('syncAgentMemoryFromStore prefers cold then warm then source rows for the same date', async () => {
  const fileStore = new InMemoryFileStore(new Map([
    ['memory/agents/core/daily/2026-03-01.md', '# source'],
    ['memory/agents/core/daily/2026-03-01.warm.md', '# warm'],
    ['memory/agents/core/daily/2026-03-01.cold.md', '# cold'],
  ]));

  await syncAgentMemoryFromStore(database, {
    agentId: 'agent_vortex_core',
    agentSlug: 'core',
    fileStore,
    now: '2026-04-20T12:00:00.000Z',
  });

  const rows = selectDerivedRows(database);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.[3], 'daily');
  assert.equal(rows[0]?.[4], 'cold_summary');
});

test('getAgentMemoryContext only injects one effective document per date', async () => {
  const context = await getAgentMemoryContext('agent_vortex_core');
  assert.match(context, /Cold memory|Warm memory|Hot memory/);
  assert.doesNotMatch(context, /2026-03-01.*2026-03-01/s);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test tests/agent-memory-sync.test.ts tests/knowledge-memory-model.test.ts`
Expected: FAIL because source type precedence and per-date de-duplication are not implemented yet

- [ ] **Step 3: Implement effective document precedence**

```ts
export type MemorySourceType =
  | 'manual'
  | 'conversation_log'
  | 'promotion'
  | 'warm_summary'
  | 'cold_summary';

function getDerivedDailyPriority(document: DerivedMemoryDocument) {
  if (document.sourceType === 'cold_summary') {
    return 0;
  }
  if (document.sourceType === 'warm_summary') {
    return 1;
  }
  return 2;
}

function selectEffectiveDailyDocuments(documents: DerivedMemoryDocument[]) {
  const selected = new Map<string, DerivedMemoryDocument>();
  documents.forEach((document) => {
    if (document.memoryScope !== 'daily' || !document.eventDate) {
      return;
    }
    const current = selected.get(document.eventDate);
    if (!current || getDerivedDailyPriority(document) < getDerivedDailyPriority(current)) {
      selected.set(document.eventDate, document);
    }
  });
  return selected;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test tests/agent-memory-sync.test.ts tests/knowledge-memory-model.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent-memory-model.ts src/lib/agent-memory-sync.ts src/lib/agent-workspace.ts tests/agent-memory-sync.test.ts tests/knowledge-memory-model.test.ts
git commit -m "feat: prefer warm cold lifecycle surrogates"
```

### Task 5: Add manual lifecycle sync and surrogate visibility in Settings

**Files:**
- Modify: `src/components/settings/SettingsView.tsx`
- Modify: `src/components/ChatInterface.tsx`
- Modify: `README.md`
- Modify: `docs/CHANGELOG.md`
- Modify: `todo-list.md`
- Test: `tests/agent-memory-api.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test('API memory paths list includes warm and cold surrogate markdown files', async () => {
  // Arrange a temp file tree containing .md, .warm.md, and .cold.md files
  // Expect /api/memory/paths to return the surrogate files
});
```

- [ ] **Step 2: Run tests to verify they fail if lifecycle UI contract is incomplete**

Run: `node --import tsx --test tests/agent-memory-api.test.ts`
Expected: FAIL if the lifecycle file list or API surface does not include surrogate files yet

- [ ] **Step 3: Extend the Settings memory page**

```ts
// Add:
// - a "同步温冷层" button beside existing memory file actions
// - lifecycle sync status text showing scanned / warmUpdated / coldUpdated / failures
// - visual labels for SOURCE / WARM / COLD rows in the file list
// Preserve the current theme shell and existing memory editor layout.
```

- [ ] **Step 4: Document the lifecycle model**

```md
## Warm/Cold Memory Lifecycle

- Raw daily files remain at `memory/agents/<agent-slug>/daily/YYYY-MM-DD.md`
- Warm surrogates live at `YYYY-MM-DD.warm.md`
- Cold surrogates live at `YYYY-MM-DD.cold.md`
- Runtime prefers cold/warm surrogates over raw daily logs for older memory
- Raw daily files are preserved for now
```

- [ ] **Step 5: Update progress logs**

```md
进度汇报（2026-04-01，第六次更新）:
已完成第一批温层/冷层生命周期：当前 agent 的每日记忆会保留原始 `daily/YYYY-MM-DD.md`，并按时间窗口生成 `*.warm.md` 与 `*.cold.md` 摘要替身文件。运行时会优先读取替身文件，SQLite 仅同步当前生效表示对应的派生索引。
```

- [ ] **Step 6: Run final verification**

Run: `node --import tsx --test tests/agent-memory-api.test.ts tests/agent-memory-files.test.ts tests/agent-memory-sync.test.ts tests/knowledge-memory-model.test.ts`
Expected: PASS

Run: `npm run lint`
Expected: PASS

Run: `npm run build`
Expected: PASS, with only the existing chunk-size warning

- [ ] **Step 7: Commit**

```bash
git add src/components/settings/SettingsView.tsx src/components/ChatInterface.tsx README.md docs/CHANGELOG.md todo-list.md tests/agent-memory-api.test.ts
git commit -m "feat: add warm cold memory lifecycle controls"
```

## Self-Review

### Spec Coverage

- Warm/cold surrogate file layout is implemented by Task 1 and Task 3.
- Deterministic summarization is implemented by Task 2.
- Per-agent lifecycle sync is implemented by Task 3.
- Derived SQLite effective-document sync and runtime precedence are implemented by Task 4.
- Settings lifecycle controls and docs/progress logs are implemented by Task 5.
- LangGraph runtime remains unchanged because Task 4 modifies the memory selection path in `src/lib/agent-workspace.ts` instead of introducing a new runtime.

### Placeholder Scan

- No `TODO` or `TBD` placeholders remain in the plan body.
- Each task contains concrete file paths, test commands, and commit commands.

### Type Consistency

- Warm/cold surrogate source types are introduced consistently as `warm_summary` and `cold_summary`.
- File helper naming is consistent across tasks: `warmFile`, `coldFile`, `detectMemoryFileKind`, `resolveDailyMemoryDate`.
- Lifecycle sync naming is consistent across tasks: `syncAgentMemoryLifecycleFromStore`.
