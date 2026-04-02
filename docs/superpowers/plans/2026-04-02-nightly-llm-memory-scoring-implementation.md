# Nightly LLM Memory Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional nightly LLM-based importance scoring for warm/cold memory surrogates while keeping `MEMORY.md` untouched and preserving a safe rule-based fallback path.

**Architecture:** Add a server-side scorer that reuses the current active model from `config.json`, then thread an optional scoring hook into the existing lifecycle sync path so surrogate frontmatter carries `importance`, `importanceReason`, `importanceSource`, `retentionSuggestion`, and `promoteSignals`. Extend nightly settings/status and Settings UI with a `useLlmScoring` toggle, and fall back to existing deterministic scoring whenever the model path is unavailable.

**Tech Stack:** React 19, Vite, TypeScript, Express, LangChain OpenAI/Anthropic clients, file-backed config store, existing nightly archive scheduler and memory lifecycle modules

---

### Task 1: Add scoring types and surrogate metadata support

**Files:**
- Modify: `src/lib/agent-memory-lifecycle.ts`
- Test: `tests/knowledge-memory-model.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test('buildWarmMemorySurrogate writes LLM importance metadata into frontmatter', () => {
  const markdown = buildWarmMemorySurrogate({
    date: '2026-04-01',
    sourcePath: 'memory/agents/core/daily/2026-04-01.md',
    sourceMarkdown: '- TODO 保留关键决策',
    now: '2026-04-20T12:00:00.000Z',
    assessment: {
      importanceScore: 5,
      reason: 'Contains a durable project decision.',
      suggestedRetention: 'warm',
      promoteSignals: ['decision', 'project state'],
      source: 'llm',
    },
  });

  assert.match(markdown, /importance: 5/);
  assert.match(markdown, /importanceSource: "llm"/);
  assert.match(markdown, /retentionSuggestion: "warm"/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/knowledge-memory-model.test.ts`
Expected: FAIL because surrogate builders do not accept an assessment payload yet

- [ ] **Step 3: Add assessment types and frontmatter wiring**

```ts
export interface MemoryImportanceAssessment {
  importanceScore: number;
  reason: string;
  suggestedRetention: 'warm' | 'cold';
  promoteSignals: string[];
  source: 'llm' | 'rules';
}

export function buildWarmMemorySurrogate(input: {
  ...
  assessment?: MemoryImportanceAssessment;
}) {
  const assessment = input.assessment ?? buildRuleBasedAssessment(...);
  // write assessment-derived frontmatter fields
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/knowledge-memory-model.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent-memory-lifecycle.ts tests/knowledge-memory-model.test.ts
git commit -m "feat: add scored memory surrogate metadata"
```

### Task 2: Add the host-side LLM scorer

**Files:**
- Create: `server/memory-importance-scorer.ts`
- Test: `tests/memory-importance-scorer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test('scoreMemoryImportanceWithModel parses a valid JSON response', async () => {
  const assessment = await scoreMemoryImportanceWithModel({
    config: normalizeAgentConfig(),
    date: '2026-04-01',
    tier: 'warm',
    sourceMarkdown: '- TODO 保留关键决策',
    invokeModel: async () =>
      JSON.stringify({
        importanceScore: 5,
        reason: 'Contains a durable decision.',
        suggestedRetention: 'warm',
        promoteSignals: ['decision'],
      }),
  });

  assert.equal(assessment.importanceScore, 5);
  assert.equal(assessment.source, 'llm');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/memory-importance-scorer.test.ts`
Expected: FAIL with module-not-found for `server/memory-importance-scorer.ts`

- [ ] **Step 3: Implement the scorer**

```ts
export async function scoreMemoryImportanceWithModel(input: {
  config: AgentConfig;
  date: string;
  tier: 'warm' | 'cold';
  sourceMarkdown: string;
  invokeModel?: (prompt: string) => Promise<string>;
}) {
  // resolve active provider/model
  // call the model with a strict JSON-only prompt
  // parse, clamp, and normalize result
  // return source: 'llm'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/memory-importance-scorer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/memory-importance-scorer.ts tests/memory-importance-scorer.test.ts
git commit -m "feat: add nightly memory importance scorer"
```

### Task 3: Thread scoring into lifecycle sync with rule fallback

**Files:**
- Modify: `src/lib/agent-memory-sync.ts`
- Modify: `src/lib/agent-memory-lifecycle.ts`
- Test: `tests/agent-memory-lifecycle.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test('syncAgentMemoryLifecycleFromStore falls back to rules when scoring callback fails', async () => {
  const fileStore = new InMemoryFileStore(
    new Map([['memory/agents/core/daily/2026-04-10.md', '- TODO 完成温层摘要']]),
  );

  await syncAgentMemoryLifecycleFromStore({
    agentSlug: 'core',
    fileStore,
    now: '2026-04-20T12:00:00.000Z',
    scoreImportance: async () => {
      throw new Error('model unavailable');
    },
  });

  const warm = await fileStore.readText('memory/agents/core/daily/2026-04-10.warm.md');
  assert.match(warm ?? '', /importanceSource: "rules"/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/agent-memory-lifecycle.test.ts`
Expected: FAIL because lifecycle sync has no scoring hook or fallback metadata

- [ ] **Step 3: Add the hook and fallback path**

```ts
export async function syncAgentMemoryLifecycleFromStore(input: {
  ...
  scoreImportance?: (input: {
    date: string;
    tier: 'warm' | 'cold';
    sourcePath: string;
    sourceMarkdown: string;
  }) => Promise<MemoryImportanceAssessment>;
}) {
  // try scoreImportance
  // on error, use buildRuleBasedMemoryAssessment(...)
  // build surrogate with the chosen assessment
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/agent-memory-lifecycle.test.ts tests/knowledge-memory-model.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent-memory-sync.ts src/lib/agent-memory-lifecycle.ts tests/agent-memory-lifecycle.test.ts tests/knowledge-memory-model.test.ts
git commit -m "feat: add scored nightly lifecycle sync"
```

### Task 4: Extend nightly archive settings and status

**Files:**
- Modify: `server/nightly-memory-archive.ts`
- Modify: `server/api-server.ts`
- Modify: `src/lib/agent-memory-api.ts`
- Test: `tests/nightly-memory-archive.test.ts`
- Test: `tests/agent-memory-api.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test('nightly archive settings persist useLlmScoring', async () => {
  const settings = await writeNightlyArchiveSettings(rootDir, {
    enabled: true,
    time: '03:00',
    useLlmScoring: true,
  });

  assert.equal(settings.useLlmScoring, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/nightly-memory-archive.test.ts tests/agent-memory-api.test.ts`
Expected: FAIL because nightly settings do not include `useLlmScoring`

- [ ] **Step 3: Add the setting and summary counters**

```ts
interface NightlyArchiveSettings {
  enabled: boolean;
  time: string;
  useLlmScoring: boolean;
}

interface NightlyArchiveRunSummary {
  ...
  llmScoredCount: number;
  ruleFallbackCount: number;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/nightly-memory-archive.test.ts tests/agent-memory-api.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/nightly-memory-archive.ts server/api-server.ts src/lib/agent-memory-api.ts tests/nightly-memory-archive.test.ts tests/agent-memory-api.test.ts
git commit -m "feat: add nightly llm scoring settings"
```

### Task 5: Connect nightly archive to config-backed model scoring and update UI/docs

**Files:**
- Modify: `server/nightly-memory-archive.ts`
- Modify: `src/components/settings/SettingsView.tsx`
- Modify: `README.md`
- Modify: `docs/CHANGELOG.md`
- Modify: `todo-list.md`

- [ ] **Step 1: Write the failing integration test**

```ts
test('nightly scheduler uses config-backed llm scoring when enabled', async () => {
  // create config.json with an active provider
  // inject a fake scorer
  // assert nightly run records llmScoredCount > 0 and writes scored frontmatter
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/nightly-memory-archive.test.ts`
Expected: FAIL because nightly scheduler does not invoke the scorer

- [ ] **Step 3: Wire the scheduler and settings UI**

```ts
// server/nightly-memory-archive.ts
// read project config
// when useLlmScoring is enabled, pass a scorer callback into syncAgentMemoryLifecycleFromStore

// src/components/settings/SettingsView.tsx
// add a toggle for 启用 LLM 重要性评分 in the existing nightly archive card
```

- [ ] **Step 4: Update docs and todo progress**

```md
- document nightly LLM scoring and rule fallback behavior
- document that current active model is reused
- record progress in todo-list.md
```

- [ ] **Step 5: Run verification**

Run: `node --import tsx --test tests/memory-importance-scorer.test.ts tests/agent-memory-lifecycle.test.ts tests/nightly-memory-archive.test.ts tests/agent-memory-api.test.ts`
Expected: PASS

Run: `npm run lint`
Expected: PASS

Run: `npm run dev`
Expected: combined host + frontend start successfully

- [ ] **Step 6: Commit**

```bash
git add server/nightly-memory-archive.ts src/components/settings/SettingsView.tsx README.md docs/CHANGELOG.md todo-list.md
git commit -m "feat: add nightly llm memory scoring"
```

## Self-Review

- Spec coverage: Task 1 adds surrogate metadata, Task 2 adds the host-side scorer, Task 3 threads scoring into lifecycle sync with fallback, Task 4 adds settings/status, and Task 5 connects scheduler, UI, docs, and final verification.
- Placeholder scan: no unresolved placeholders remain in the plan steps.
- Type consistency: `MemoryImportanceAssessment`, `useLlmScoring`, `llmScoredCount`, and `ruleFallbackCount` are used consistently across scoring, scheduler, API, and UI tasks.
