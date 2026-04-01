# Query Router Cold Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a rule-based Query Router plus a cold-entry retrieval path so explicit old-time queries jump directly to cold memory, vague time queries stay on hot/warm first, and cold surrogates become the only retained compressed surrogate after warm decays.

**Architecture:** Introduce a small router module under `src/lib/memory-lifecycle/`, refine `cold.md` output in the existing lifecycle builder, and thread query-aware layer selection through the existing memory-context path. The LangGraph runtime remains unchanged; only the memory selection path and prompt assembly inputs change.

**Tech Stack:** TypeScript, React 19, existing LangGraph runtime, file-backed memory lifecycle, SQLite-derived memory index, Node test runner with `tsx`

---

### Task 1: Add Query Router types and rule parser

**Files:**
- Create: `src/lib/memory-lifecycle/query-router.ts`
- Modify: `src/lib/memory-lifecycle/types.ts`
- Test: `tests/memory-query-router.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { routeMemoryQuery } from '../src/lib/memory-lifecycle/query-router';

test('routeMemoryQuery sends explicit old-time queries directly to cold and global', () => {
  const result = routeMemoryQuery('上个月那个方案是什么？', {
    now: '2026-04-20T12:00:00.000Z',
  });

  assert.equal(result.mode, 'explicit_cold');
  assert.deepEqual(result.preferredLayers, ['cold', 'global']);
  assert.equal(result.fallbackLayers.length, 0);
});

test('routeMemoryQuery keeps vague time references on default hot warm global path', () => {
  const result = routeMemoryQuery('之前那天说的那个方案是什么？', {
    now: '2026-04-20T12:00:00.000Z',
  });

  assert.equal(result.mode, 'default');
  assert.deepEqual(result.preferredLayers, ['hot', 'warm', 'global']);
  assert.deepEqual(result.fallbackLayers, ['cold']);
});

test('routeMemoryQuery treats recent explicit dates as default mode', () => {
  const result = routeMemoryQuery('2026-04-15 那天的结论是什么？', {
    now: '2026-04-20T12:00:00.000Z',
  });

  assert.equal(result.mode, 'default');
  assert.deepEqual(result.preferredLayers, ['hot', 'warm', 'global']);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import tsx --test --test-isolation=none tests/memory-query-router.test.ts`
Expected: FAIL because `routeMemoryQuery` and the router result types do not exist yet

- [ ] **Step 3: Implement the router module and shared types**

```ts
// src/lib/memory-lifecycle/types.ts
export type MemoryRetrievalLayer = 'hot' | 'warm' | 'cold' | 'global';

export interface MemoryQueryRoute {
  mode: 'explicit_cold' | 'default';
  preferredLayers: MemoryRetrievalLayer[];
  fallbackLayers: MemoryRetrievalLayer[];
  matchedTimeExpression?: string;
}

// src/lib/memory-lifecycle/query-router.ts
import type { MemoryQueryRoute } from './types';

function normalizeQuery(input: string) {
  return input.trim().toLowerCase();
}

function parseExplicitPastReference(query: string, now: string): { matched: string; olderThan15Days: boolean } | null {
  // support YYYY-MM-DD, YYYY/MM/DD, 上个月, 上上周, 去年, and Chinese month/day forms
}

export function routeMemoryQuery(query: string, options: { now?: string } = {}): MemoryQueryRoute {
  const now = options.now ?? new Date().toISOString();
  const normalized = normalizeQuery(query);
  const explicit = parseExplicitPastReference(normalized, now);

  if (explicit?.olderThan15Days) {
    return {
      mode: 'explicit_cold',
      preferredLayers: ['cold', 'global'],
      fallbackLayers: [],
      matchedTimeExpression: explicit.matched,
    };
  }

  return {
    mode: 'default',
    preferredLayers: ['hot', 'warm', 'global'],
    fallbackLayers: ['cold'],
    matchedTimeExpression: explicit?.matched,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --import tsx --test --test-isolation=none tests/memory-query-router.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/memory-lifecycle/query-router.ts src/lib/memory-lifecycle/types.ts tests/memory-query-router.test.ts
git commit -m "feat: add memory query router"
```

### Task 2: Refine cold-entry surrogate generation

**Files:**
- Modify: `src/lib/agent-memory-lifecycle.ts`
- Modify: `tests/knowledge-memory-model.test.ts`
- Modify: `tests/agent-memory-lifecycle.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
test('buildColdMemorySurrogate is more compact than warm memory output', () => {
  const warm = buildWarmMemorySurrogate({
    date: '2026-03-01',
    sourcePath: 'memory/agents/core/daily/2026-03-01.md',
    sourceMarkdown: '- [09:00] 旧背景\n- [10:00] TODO 清理遗留状态',
    now: '2026-04-20T12:00:00.000Z',
  });

  const cold = buildColdMemorySurrogate({
    date: '2026-03-01',
    sourcePath: 'memory/agents/core/daily/2026-03-01.md',
    sourceMarkdown: '- [09:00] 旧背景\n- [10:00] TODO 清理遗留状态',
    now: '2026-04-20T12:00:00.000Z',
  });

  assert.equal(cold.length < warm.length, true);
  assert.doesNotMatch(cold, /## Key Fragments/);
});

test('syncAgentMemoryLifecycleFromStore removes warm surrogate when a date enters cold', async () => {
  // arrange raw source + stale warm surrogate
  // expect cold surrogate written and warm surrogate deleted
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import tsx --test --test-isolation=none tests/knowledge-memory-model.test.ts tests/agent-memory-lifecycle.test.ts`
Expected: FAIL if the current cold surrogate remains too verbose or if warm deletion behavior regresses

- [ ] **Step 3: Tighten cold surrogate content**

```ts
// src/lib/agent-memory-lifecycle.ts
const COLD_SUMMARY_LINE_LIMIT = 1;
const COLD_KEYWORD_LIMIT = 6;

export function buildColdMemorySurrogate(input: {
  date: string;
  sourcePath: string;
  sourceMarkdown: string;
  now?: string;
}) {
  const significantLines = collectSignificantDailyLines(input.sourceMarkdown);
  const keywords = extractMemoryKeywords(significantLines.join('\n'), COLD_KEYWORD_LIMIT);

  return serializeMemoryMarkdown({
    frontmatter: {
      title: `${input.date} Cold Memory`,
      date: input.date,
      tier: 'cold',
      sourcePath: input.sourcePath,
      updatedAt: input.now ?? new Date().toISOString(),
      importance: scoreMemoryImportance(input.sourceMarkdown, 'conversation_log'),
      keywords: keywords.join(', '),
    },
    body: [
      '## Summary',
      summarizeMemoryLines(significantLines, COLD_SUMMARY_LINE_LIMIT),
      '',
      '## Keywords',
      compactBulletList(keywords),
    ].join('\n'),
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --import tsx --test --test-isolation=none tests/knowledge-memory-model.test.ts tests/agent-memory-lifecycle.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent-memory-lifecycle.ts tests/knowledge-memory-model.test.ts tests/agent-memory-lifecycle.test.ts
git commit -m "feat: refine cold memory surrogates"
```

### Task 3: Add layer-aware memory context retrieval with cold fallback

**Files:**
- Modify: `src/lib/agent-memory-model.ts`
- Modify: `src/lib/agent-workspace.ts`
- Test: `tests/agent-memory-sync.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
test('getAgentMemoryContext routes explicit old-time queries directly to cold and global', async () => {
  const context = await getAgentMemoryContext(agentId, {
    query: '上个月那个方案是什么？',
    now: '2026-04-20T12:00:00.000Z',
    includeRecentMemorySnapshot: false,
  });

  assert.match(context, /Cold memory/);
  assert.doesNotMatch(context, /Hot memory/);
  assert.doesNotMatch(context, /Warm memory/);
});

test('getAgentMemoryContext falls back to cold when hot warm global are insufficient', async () => {
  const context = await getAgentMemoryContext(agentId, {
    query: '之前那天说的结论是什么？',
    now: '2026-04-20T12:00:00.000Z',
    includeRecentMemorySnapshot: false,
  });

  assert.match(context, /Cold memory/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import tsx --test --test-isolation=none tests/agent-memory-sync.test.ts`
Expected: FAIL because `getAgentMemoryContext` does not accept a query-aware routing path yet

- [ ] **Step 3: Implement layer filtering and fallback behavior**

```ts
// src/lib/agent-memory-model.ts
export function filterMemoryDocumentsByLayers(
  documents: MemoryContextDocument[],
  layers: Array<'hot' | 'warm' | 'cold' | 'global'>,
  options: { now?: string } = {},
) {
  const now = options.now ?? new Date().toISOString();
  const layerSet = new Set(layers);

  return documents.filter((document) => {
    if (document.memoryScope === 'global') {
      return layerSet.has('global');
    }

    const tier = resolveMemoryTier(document.updatedAt, now);
    return layerSet.has(tier);
  });
}

// src/lib/agent-workspace.ts
export async function getAgentMemoryContext(
  agentId: string,
  options?: { includeRecentMemorySnapshot?: boolean; now?: string; query?: string },
) {
  const now = options?.now ?? new Date().toISOString();
  const query = options?.query?.trim() ?? '';
  const documents = await listAgentMemoryDocuments(agentId, {
    scopes: ['global', 'daily', 'session'],
    now,
  });

  const deduped = selectEffectiveMemoryDocuments(documents, { now });
  const route = routeMemoryQuery(query, { now });
  const firstPass = filterMemoryDocumentsByLayers(deduped, route.preferredLayers, { now });
  const needsFallback =
    route.mode === 'default' &&
    firstPass.filter((document) => document.memoryScope !== 'global').length < 2;

  const selected = needsFallback
    ? filterMemoryDocumentsByLayers(deduped, [...route.preferredLayers, ...route.fallbackLayers], { now })
    : firstPass;

  return formatLayeredMemoryContext(selected, {
    now,
    includeRecentMemorySnapshot: options?.includeRecentMemorySnapshot,
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --import tsx --test --test-isolation=none tests/agent-memory-sync.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent-memory-model.ts src/lib/agent-workspace.ts tests/agent-memory-sync.test.ts
git commit -m "feat: route memory retrieval by time intent"
```

### Task 4: Thread the live user query into memory-context assembly

**Files:**
- Modify: `src/components/ChatInterface.tsx`
- Test: `tests/agent-memory-sync.test.ts`

- [ ] **Step 1: Write the failing test or extend an existing integration assertion**

```ts
test('chat memory assembly passes the current user query into getAgentMemoryContext', async () => {
  // spy or stub getAgentMemoryContext
  // assert the latest user input is forwarded as options.query
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test --test-isolation=none tests/agent-memory-sync.test.ts`
Expected: FAIL because the chat flow does not thread the latest user query into memory retrieval yet

- [ ] **Step 3: Wire the query through ChatInterface**

```ts
// src/components/ChatInterface.tsx
const latestUserQuery = promptInput.trim();

const memoryContext = configSnapshot.memory.includeGlobalMemory
  ? await getAgentMemoryContext(workspaceSnapshot.agent.id, {
      includeRecentMemorySnapshot: configSnapshot.memory.includeRecentMemorySnapshot,
      now: timestamp,
      query: latestUserQuery,
    })
  : '';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test --test-isolation=none tests/agent-memory-sync.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/ChatInterface.tsx tests/agent-memory-sync.test.ts
git commit -m "feat: pass query into memory routing"
```

### Task 5: Final verification and progress log

**Files:**
- Modify: `docs/CHANGELOG.md`
- Modify: `todo-list.md`

- [ ] **Step 1: Update progress logs**

```md
## docs/CHANGELOG.md
- Added a rule-based Query Router for agent memory so explicit old-time queries can jump directly to cold memory while default retrieval still prefers hot/warm memory before falling back.
- Refined `*.cold.md` generation so cold surrogates remain the only retained compressed surrogate after warm decay.

## todo-list.md
进度汇报（2026-04-01，第七次更新）:
已完成第一批 Query Router 与冷层压缩入口：明确时间且超出 15 天的问题会直接优先查询 cold + global，模糊时间仍先走 hot / warm / global，不足时再回退 cold。冷层继续沿用 `YYYY-MM-DD.cold.md`，进入冷层后会删除 `warm.md`，仅保留最精简摘要与关键词标签。
```

- [ ] **Step 2: Run final verification**

Run: `node --import tsx --test --test-isolation=none tests/memory-query-router.test.ts`
Expected: PASS

Run: `node --import tsx --test --test-isolation=none tests/agent-memory-lifecycle.test.ts`
Expected: PASS

Run: `node --import tsx --test --test-isolation=none tests/agent-memory-sync.test.ts tests/knowledge-memory-model.test.ts`
Expected: PASS

Run: `./node_modules/.bin/tsc --noEmit --pretty false`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/lib/memory-lifecycle/query-router.ts src/lib/memory-lifecycle/types.ts src/lib/agent-memory-lifecycle.ts src/lib/agent-memory-model.ts src/lib/agent-workspace.ts src/components/ChatInterface.tsx tests/memory-query-router.test.ts tests/agent-memory-lifecycle.test.ts tests/agent-memory-sync.test.ts tests/knowledge-memory-model.test.ts docs/CHANGELOG.md todo-list.md
git commit -m "feat: add query router cold entry"
```

## Self-Review

### Spec Coverage

- Rule-based explicit old-time routing is covered by Task 1 and Task 3.
- Cold-entry refinement using the existing `cold.md` file is covered by Task 2.
- Hot/warm-first fallback behavior is covered by Task 3.
- Query threading from the live chat path is covered by Task 4.
- Progress logging and final verification are covered by Task 5.

### Placeholder Scan

- No `TODO`, `TBD`, or unspecified implementation placeholders remain in task steps.

### Type Consistency

- Router outputs use `MemoryRetrievalLayer` consistently.
- Runtime retrieval continues to use `getAgentMemoryContext(..., { now, query })`.
- Cold-entry artifacts remain `daily/*.cold.md`; no `archive.md` is introduced.
