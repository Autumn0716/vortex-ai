# Cold Memory Vector Archive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated cold-memory vector archive so `*.cold.md` files can be embedded, indexed, and retrieved semantically only when the existing Query Router decides cold memory should be consulted.

**Architecture:** Extend the existing agent workspace schema with a memory-specific embedding table, reuse the current embedding client/config to sync vectors for effective `cold_summary` rows, and add a small runtime retrieval helper that merges top cold semantic hits into prompt assembly only on cold-routed paths. The Markdown files remain the only source of truth; vectors are fully derived and rebuildable.

**Tech Stack:** TypeScript, React 19, SQLite wasm, existing embedding client, LangGraph runtime, Node test runner with `tsx`

---

### Task 1: Add cold-memory vector storage schema and shared embedding helpers

**Files:**
- Modify: `src/lib/agent-workspace-schema.ts`
- Modify: `src/lib/db.ts`
- Test: `tests/agent-workspace-schema.test.ts`

- [ ] **Step 1: Write the failing schema test**

```ts
test('ensureAgentWorkspaceSchema creates cold memory embedding storage', () => {
  const runs: string[] = [];

  const database = {
    run(sql: string) {
      runs.push(sql);
    },
    exec(sql: string) {
      if (sql === 'PRAGMA table_info(agent_memory_documents)') {
        return [
          {
            columns: ['name'],
            values: [
              ['id'],
              ['agent_id'],
              ['title'],
              ['content'],
              ['memory_scope'],
              ['source_type'],
              ['importance_score'],
              ['topic_id'],
              ['event_date'],
              ['created_at'],
              ['updated_at'],
            ],
          },
        ];
      }

      return [];
    },
  };

  ensureAgentWorkspaceSchema(database);

  assert.ok(runs.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS agent_memory_embeddings')));
  assert.ok(runs.some((sql) => sql.includes('CREATE INDEX IF NOT EXISTS idx_agent_memory_embeddings_agent_source')));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test --test-isolation=none tests/agent-workspace-schema.test.ts`
Expected: FAIL because the schema does not yet create `agent_memory_embeddings`

- [ ] **Step 3: Add the schema and expose shared embedding helpers**

```ts
// src/lib/agent-workspace-schema.ts
database.run(`
  CREATE TABLE IF NOT EXISTS agent_memory_embeddings (
    memory_document_id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    event_date TEXT,
    source_type TEXT NOT NULL,
    embedding_model TEXT NOT NULL,
    embedding_dimensions INTEGER NOT NULL,
    content_hash TEXT NOT NULL,
    embedding_json TEXT NOT NULL,
    content_preview TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

database.run(`
  CREATE INDEX IF NOT EXISTS idx_agent_memory_embeddings_agent_source
  ON agent_memory_embeddings(agent_id, source_type, updated_at DESC);

  CREATE INDEX IF NOT EXISTS idx_agent_memory_embeddings_agent_event
  ON agent_memory_embeddings(agent_id, event_date DESC);
`);

// src/lib/db.ts
export function buildEmbeddingConfigFromDocuments(...) { ... }
export function parseEmbeddingJson(embeddingJson: string) { ... }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test --test-isolation=none tests/agent-workspace-schema.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent-workspace-schema.ts src/lib/db.ts tests/agent-workspace-schema.test.ts
git commit -m "feat: add cold memory embedding schema"
```

### Task 2: Sync vectors for effective cold memory rows

**Files:**
- Modify: `src/lib/agent-memory-sync.ts`
- Modify: `tests/agent-memory-sync.test.ts`

- [ ] **Step 1: Write the failing sync tests**

```ts
test('syncAgentMemoryFromStore upserts cold memory embeddings when embedding config is available', async () => {
  // arrange one cold day, mock embedding response
  // expect one row in agent_memory_embeddings
});

test('syncAgentMemoryFromStore deletes stale cold embeddings when cold surrogate disappears', async () => {
  // arrange cold embedding row, remove cold surrogate, resync
  // expect embedding row deleted
});

test('syncAgentMemoryFromStore skips cold vector sync when embedding config is unavailable', async () => {
  // arrange cold surrogate without embedding config
  // expect no throw and no rows in agent_memory_embeddings
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import tsx --test --test-isolation=none tests/agent-memory-sync.test.ts`
Expected: FAIL because cold vector sync does not exist yet

- [ ] **Step 3: Implement cold vector sync in the memory sync path**

```ts
// src/lib/agent-memory-sync.ts
async function syncColdMemoryEmbeddings(
  database: Database,
  documents: DerivedMemoryDocument[],
  embeddingConfig: EmbeddingProviderConfig | null,
) {
  const coldDocuments = documents.filter((document) => document.sourceType === 'cold_summary');

  if (!embeddingConfig) {
    deleteStaleColdMemoryEmbeddings(database, coldDocuments.map((document) => document.id));
    return;
  }

  for (const document of coldDocuments) {
    const contentHash = buildEmbeddingContentHash(document.content);
    const existing = readColdMemoryEmbedding(database, document.id);
    if (existing?.content_hash === contentHash) {
      continue;
    }

    const response = await createEmbeddings(document.content, embeddingConfig);
    const embedding = response.data[0]?.embedding;
    if (!Array.isArray(embedding) || embedding.length === 0) {
      continue;
    }

    upsertColdMemoryEmbedding(database, {
      memoryDocumentId: document.id,
      agentId: ...,
      eventDate: document.eventDate,
      sourceType: document.sourceType,
      model: embeddingConfig.model,
      dimensions: embedding.length,
      contentHash,
      embeddingJson: JSON.stringify(embedding),
      contentPreview: document.content.slice(0, 240),
      updatedAt: document.updatedAt,
    });
  }

  deleteStaleColdMemoryEmbeddings(database, coldDocuments.map((document) => document.id));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --import tsx --test --test-isolation=none tests/agent-memory-sync.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent-memory-sync.ts tests/agent-memory-sync.test.ts
git commit -m "feat: sync cold memory embeddings"
```

### Task 3: Add cold-memory vector retrieval and runtime integration

**Files:**
- Modify: `src/lib/agent-workspace.ts`
- Modify: `tests/agent-memory-sync.test.ts`

- [ ] **Step 1: Write the failing retrieval tests**

```ts
test('getAgentMemoryContext uses cold vector retrieval for explicit_cold queries', async () => {
  // arrange cold embedding + cold derived row + global row
  // expect semantically matched cold day appears in context
});

test('getAgentMemoryContext uses cold vector retrieval only after default recent-layer insufficiency', async () => {
  // arrange one hot day plus two cold days with embeddings
  // expect fallback path includes only top cold semantic match
});

test('getAgentMemoryContext skips cold vector retrieval safely when embedding config is missing', async () => {
  // arrange explicit_cold query without embedding config
  // expect no throw and file-backed cold memory still works
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import tsx --test --test-isolation=none tests/agent-memory-sync.test.ts`
Expected: FAIL because runtime does not yet query `agent_memory_embeddings`

- [ ] **Step 3: Implement the retrieval helper and merge logic**

```ts
// src/lib/agent-workspace.ts
async function searchColdMemoryEmbeddings(
  database: Database,
  agentId: string,
  query: string,
  embeddingConfig: EmbeddingProviderConfig | null,
) {
  if (!embeddingConfig) {
    return [];
  }

  const response = await createEmbeddings(query, embeddingConfig);
  const queryEmbedding = response.data[0]?.embedding;
  if (!Array.isArray(queryEmbedding) || queryEmbedding.length === 0) {
    return [];
  }

  const rows = mapRows<{ memory_document_id: string; embedding_json: string }>(
    database.exec(`
      SELECT memory_document_id, embedding_json
      FROM agent_memory_embeddings
      WHERE agent_id = ? AND source_type = 'cold_summary'
    `, [agentId]),
  );

  return rows
    .map((row) => ({ id: row.memory_document_id, score: cosineSimilarity(queryEmbedding, parseEmbeddingJson(row.embedding_json)) }))
    .filter((row) => row.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3);
}

// merge retrieved cold document ids back into routedDocuments with de-duplication
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --import tsx --test --test-isolation=none tests/agent-memory-sync.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent-workspace.ts tests/agent-memory-sync.test.ts
git commit -m "feat: retrieve cold memory by vector search"
```

### Task 4: Record progress and verify the end-to-end workflow

**Files:**
- Modify: `README.md`
- Modify: `docs/CHANGELOG.md`
- Modify: `todo-list.md`

- [ ] **Step 1: Update docs**

```md
- README: mark cold memory vector archive as in progress or first-pass complete, depending on implementation result
- CHANGELOG: record cold memory embedding sync and runtime retrieval
- todo-list: append a new dated progress note under the memory mechanism section
```

- [ ] **Step 2: Run focused verification**

Run:
- `node --import tsx --test --test-isolation=none tests/agent-workspace-schema.test.ts`
- `node --import tsx --test --test-isolation=none tests/agent-memory-sync.test.ts`
- `node --import tsx --test --test-isolation=none tests/memory-query-router.test.ts`
- `npm run lint`

Expected: PASS

- [ ] **Step 3: Verify the dev server boots**

Run: `npm run dev`
Expected: Vite starts successfully on port `3000`

- [ ] **Step 4: Commit docs/result updates**

```bash
git add README.md docs/CHANGELOG.md todo-list.md
git commit -m "docs: record cold memory vector archive progress"
```
