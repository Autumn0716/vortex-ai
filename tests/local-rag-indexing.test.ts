import test from 'node:test';
import assert from 'node:assert/strict';
import initSqlite from '@sqlite.org/sqlite-wasm';
import {
  Database,
  clearDocumentSearchCache,
  getDocumentFtsEnabled,
  indexDocumentChunks,
  parseEmbeddingJson,
  searchKnowledgeDocuments,
  searchDocumentsInDatabase,
} from '../src/lib/db';

const TEST_EMBEDDING_CONFIG = {
  provider: 'openai-compatible' as const,
  model: 'text-embedding-test',
  baseUrl: 'https://example.test/v1',
  apiKey: 'test-key',
  dimensions: 3,
};

function installEmbeddingFetchMock(routes: Array<{ match: string; embedding: number[] }>) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { input?: string | string[] };
    const input = Array.isArray(body.input) ? body.input.join('\n') : String(body.input ?? '');
    const route = routes.find((candidate) => input.includes(candidate.match));
    if (!route) {
      throw new Error(`No embedding mock configured for input: ${input}`);
    }

    return {
      ok: true,
      async json() {
        return {
          data: [{ index: 0, embedding: route.embedding }],
          model: TEST_EMBEDDING_CONFIG.model,
        };
      },
    } as Response;
  }) as typeof fetch;

  return () => {
    globalThis.fetch = originalFetch;
  };
}

async function createSearchDatabase() {
  const sqlite3 = await initSqlite();
  const inner = new sqlite3.oo1.DB(':memory:');
  const database = new Database(sqlite3, inner);

  database.run(`
    CREATE TABLE documents (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL
    );

    CREATE TABLE document_chunks (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE document_search_cache (
      cache_key TEXT PRIMARY KEY,
      query TEXT NOT NULL,
      results_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE document_metadata (
      document_id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL,
      source_uri TEXT,
      tags_json TEXT NOT NULL,
      synced_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE document_chunk_embeddings (
      chunk_id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      model TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      embedding_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE document_graph_nodes (
      document_id TEXT NOT NULL,
      normalized_entity TEXT NOT NULL,
      entity TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      weight REAL NOT NULL,
      PRIMARY KEY (document_id, normalized_entity, entity_type)
    );

    CREATE TABLE document_graph_edges (
      document_id TEXT NOT NULL,
      source_entity TEXT NOT NULL,
      target_entity TEXT NOT NULL,
      relation TEXT NOT NULL,
      weight REAL NOT NULL,
      PRIMARY KEY (document_id, source_entity, target_entity, relation)
    );
  `);

  return database;
}

test('getDocumentFtsEnabled only reports true when the FTS table exists', async () => {
  const database = await createSearchDatabase();

  try {
    assert.equal(getDocumentFtsEnabled(database), false);

    database.run(`
      CREATE VIRTUAL TABLE document_chunks_fts USING fts5(
        chunk_id UNINDEXED,
        document_id UNINDEXED,
        title,
        content
      );
    `);

    assert.equal(getDocumentFtsEnabled(database), true);
  } finally {
    database.close();
  }
});

test('indexDocumentChunks stores chunk rows and mirrors them into the FTS table', async () => {
  const database = await createSearchDatabase();

  try {
    database.run(`
      CREATE VIRTUAL TABLE document_chunks_fts USING fts5(
        chunk_id UNINDEXED,
        document_id UNINDEXED,
        title,
        content
      );
    `);

    indexDocumentChunks(database, {
      id: 'doc_alpha',
      title: 'Alpha Notes',
      content:
        'semantic cache planning retrieval orchestration hybrid search document chunking '.repeat(20),
    });

    const chunkCount = Number(database.exec('SELECT COUNT(*) AS count FROM document_chunks')[0]?.values[0]?.[0] ?? 0);
    const ftsCount = Number(database.exec('SELECT COUNT(*) AS count FROM document_chunks_fts')[0]?.values[0]?.[0] ?? 0);

    assert.ok(chunkCount > 1);
    assert.equal(ftsCount, chunkCount);
  } finally {
    database.close();
  }
});

test('clearDocumentSearchCache removes all cached search payloads', async () => {
  const database = await createSearchDatabase();

  try {
    database.run(
      `
        INSERT INTO document_search_cache (cache_key, query, results_json, updated_at)
        VALUES (?, ?, ?, ?)
      `,
      ['query:alpha', 'alpha', '[]', '2026-04-01T00:00:00.000Z'],
    );

    clearDocumentSearchCache(database);

    const cacheCount = Number(
      database.exec('SELECT COUNT(*) AS count FROM document_search_cache')[0]?.values[0]?.[0] ?? 0,
    );
    assert.equal(cacheCount, 0);
  } finally {
    database.close();
  }
});

test('parseEmbeddingJson warns and returns an empty vector for malformed JSON', () => {
  const originalWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (message?: unknown) => {
    warnings.push(String(message ?? ''));
  };

  try {
    assert.deepEqual(parseEmbeddingJson('{"embedding": '), []);
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(warnings.length, 1);
  assert.match(warnings[0] ?? '', /Failed to parse embedding JSON/);
});

test('searchDocumentsInDatabase uses decomposed FTS queries and persists cache entries', async () => {
  const database = await createSearchDatabase();

  try {
    database.run(`
      CREATE VIRTUAL TABLE document_chunks_fts USING fts5(
        chunk_id UNINDEXED,
        document_id UNINDEXED,
        title,
        content
      );
    `);

    database.run(
      'INSERT INTO documents (id, title, content) VALUES (?, ?, ?)',
      [
        'doc_planning',
        'Planning Guide',
        'query logs and then send emails with a semantic cache backed skills workflow',
      ],
    );
    indexDocumentChunks(database, {
      id: 'doc_planning',
      title: 'Planning Guide',
      content: 'query logs and then send emails with a semantic cache backed skills workflow',
    });

    const results = await searchDocumentsInDatabase(database, 'query logs, then send emails');
    const cachedRows = Number(
      database.exec('SELECT COUNT(*) AS count FROM document_search_cache')[0]?.values[0]?.[0] ?? 0,
    );

    assert.equal(results.length, 1);
    assert.equal(results[0]?.id, 'doc_planning');
    assert.equal(cachedRows, 1);
  } finally {
    database.close();
  }
});

test('searchDocumentsInDatabase warns and recomputes when cached results are malformed', async () => {
  const database = await createSearchDatabase();

  try {
    database.run(`
      CREATE VIRTUAL TABLE document_chunks_fts USING fts5(
        chunk_id UNINDEXED,
        document_id UNINDEXED,
        title,
        content
      );
    `);

    database.run(
      'INSERT INTO documents (id, title, content) VALUES (?, ?, ?)',
      ['doc_cache_corrupt', 'Cache Recovery', 'cache recovery should recompute retrieval results after corruption'],
    );
    indexDocumentChunks(database, {
      id: 'doc_cache_corrupt',
      title: 'Cache Recovery',
      content: 'cache recovery should recompute retrieval results after corruption',
    });

    await searchDocumentsInDatabase(database, 'cache recovery');
    database.run('UPDATE document_search_cache SET results_json = ?', ['{"broken": ']);

    const originalWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (message?: unknown) => {
      warnings.push(String(message ?? ''));
    };

    try {
      const results = await searchDocumentsInDatabase(database, 'cache recovery');

      assert.equal(results.length, 1);
      assert.equal(results[0]?.id, 'doc_cache_corrupt');
    } finally {
      console.warn = originalWarn;
    }

    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? '', /Failed to parse document search cache/);
  } finally {
    database.close();
  }
});

test('searchDocumentsInDatabase rewrites conversational and cross-lingual queries before recall', async () => {
  const database = await createSearchDatabase();

  try {
    database.run(`
      CREATE VIRTUAL TABLE document_chunks_fts USING fts5(
        chunk_id UNINDEXED,
        document_id UNINDEXED,
        title,
        content
      );
    `);

    database.run(
      'INSERT INTO documents (id, title, content) VALUES (?, ?, ?)',
      [
        'doc_branch_handoff',
        'Branch Handoff Guide',
        'branch handoff summary to parent topic with child subtask findings and audit notes',
      ],
    );
    indexDocumentChunks(database, {
      id: 'doc_branch_handoff',
      title: 'Branch Handoff Guide',
      content: 'branch handoff summary to parent topic with child subtask findings and audit notes',
    });

    const results = await searchDocumentsInDatabase(database, '怎么把分支结果回传给父会话');

    assert.equal(results.length, 1);
    assert.equal(results[0]?.id, 'doc_branch_handoff');
  } finally {
    database.close();
  }
});

test('searchDocumentsInDatabase returns compressed excerpts instead of full document bodies', async () => {
  const database = await createSearchDatabase();

  try {
    database.run(`
      CREATE VIRTUAL TABLE document_chunks_fts USING fts5(
        chunk_id UNINDEXED,
        document_id UNINDEXED,
        title,
        content
      );
    `);

    const content = [
      'Intro section that is not important to the query and mostly discusses unrelated setup notes.'.repeat(4),
      'Another paragraph with general commentary and filler that should be compressed away in retrieval.'.repeat(4),
      'Critical branch handoff summary to parent topic with rollout checklist and audit note.',
      'Closing section with unrelated observations and archival remarks that are not needed for the prompt.'.repeat(4),
    ].join(' ');

    database.run(
      'INSERT INTO documents (id, title, content) VALUES (?, ?, ?)',
      ['doc_compression', 'Compression Guide', content],
    );
    indexDocumentChunks(database, {
      id: 'doc_compression',
      title: 'Compression Guide',
      content,
    });

    const results = await searchDocumentsInDatabase(database, 'branch handoff summary');

    assert.equal(results.length, 1);
    assert.ok((results[0]?.content.length ?? 0) < content.length);
    assert.match(results[0]?.content ?? '', /branch handoff summary to parent topic/i);
  } finally {
    database.close();
  }
});

test('searchDocumentsInDatabase attaches deterministic support metadata', async () => {
  const database = await createSearchDatabase();

  try {
    database.run(`
      CREATE VIRTUAL TABLE document_chunks_fts USING fts5(
        chunk_id UNINDEXED,
        document_id UNINDEXED,
        title,
        content
      );
    `);

    database.run(
      'INSERT INTO documents (id, title, content) VALUES (?, ?, ?)',
      ['doc_support', 'Branch Handoff Summary', 'branch handoff summary to parent topic and rollout steps'],
    );
    indexDocumentChunks(database, {
      id: 'doc_support',
      title: 'Branch Handoff Summary',
      content: 'branch handoff summary to parent topic and rollout steps',
    });

    const results = await searchDocumentsInDatabase(database, 'branch handoff summary');

    assert.equal(results[0]?.supportLabel, 'high');
    assert.ok((results[0]?.supportScore ?? 0) >= 0.85);
    assert.ok((results[0]?.matchedTerms?.length ?? 0) > 0);
  } finally {
    database.close();
  }
});

test('searchDocumentsInDatabase includes vector-only results in hybrid retrieval without displacing lexical leaders', async () => {
  const restoreFetch = installEmbeddingFetchMock([
    {
      match: 'branch handoff summary with audit notes and parent topic checklist',
      embedding: [0.6, 0.4, 0],
    },
    {
      match: 'upstream return flow for child workers and review routing metadata',
      embedding: [1, 0, 0],
    },
    {
      match: 'branch handoff summary',
      embedding: [1, 0, 0],
    },
  ]);
  const database = await createSearchDatabase();

  try {
    database.run(`
      CREATE VIRTUAL TABLE document_chunks_fts USING fts5(
        chunk_id UNINDEXED,
        document_id UNINDEXED,
        title,
        content
      );
    `);

    database.run(
      'INSERT INTO documents (id, title, content) VALUES (?, ?, ?)',
      [
        'doc_lexical',
        'Branch Handoff Summary',
        'branch handoff summary with audit notes and parent topic checklist',
      ],
    );
    database.run(
      'INSERT INTO documents (id, title, content) VALUES (?, ?, ?)',
      [
        'doc_vector',
        'Worker Return Routing',
        'upstream return flow for child workers and review routing metadata',
      ],
    );

    indexDocumentChunks(database, {
      id: 'doc_lexical',
      title: 'Branch Handoff Summary',
      content: 'branch handoff summary with audit notes and parent topic checklist',
    });
    indexDocumentChunks(database, {
      id: 'doc_vector',
      title: 'Worker Return Routing',
      content: 'upstream return flow for child workers and review routing metadata',
    });

    const results = await searchDocumentsInDatabase(database, 'branch handoff summary', {
      embeddingConfig: TEST_EMBEDDING_CONFIG,
    });

    assert.equal(results[0]?.id, 'doc_lexical');
    assert.ok(results.some((result) => result.id === 'doc_vector'));
  } finally {
    restoreFetch();
    database.close();
  }
});

test('searchDocumentsInDatabase uses graph overlap as an additional ranking signal', async () => {
  const database = await createSearchDatabase();

  try {
    database.run(`
      CREATE VIRTUAL TABLE document_chunks_fts USING fts5(
        chunk_id UNINDEXED,
        document_id UNINDEXED,
        title,
        content
      );
    `);

    const weakLexical =
      'General retrieval notes about summaries and ranking. # Branch Handoff\nUse `parent_topic_id` when sending a branch summary upward.';
    const strongerLexical =
      'branch branch branch summary summary notes about returning information with a generic process.';

    database.run(
      'INSERT INTO documents (id, title, content) VALUES (?, ?, ?)',
      ['doc_graph', 'Topic Branch Guide', weakLexical],
    );
    database.run(
      'INSERT INTO documents (id, title, content) VALUES (?, ?, ?)',
      ['doc_plain', 'Generic Summary Notes', strongerLexical],
    );
    indexDocumentChunks(database, {
      id: 'doc_graph',
      title: 'Topic Branch Guide',
      content: weakLexical,
    });
    indexDocumentChunks(database, {
      id: 'doc_plain',
      title: 'Generic Summary Notes',
      content: strongerLexical,
    });

    const results = await searchDocumentsInDatabase(database, 'parent topic branch handoff');

    assert.equal(results[0]?.id, 'doc_graph');
    assert.ok((results[0]?.graphHints?.length ?? 0) > 0);

    const graphDisabledResults = await searchDocumentsInDatabase(database, 'parent topic branch handoff', {
      searchWeights: {
        graphWeight: 0,
      },
    });

    assert.equal(graphDisabledResults.length > 0, true);
    const cacheKeys = database
      .exec('SELECT cache_key FROM document_search_cache ORDER BY cache_key ASC')[0]
      ?.values.map((row) => String(row[0])) ?? [];
    assert.equal(cacheKeys.length, 2);
    assert.ok(cacheKeys.some((key) => key.includes('weights=,,0')));
  } finally {
    database.close();
  }
});

test('searchDocumentsInDatabase keeps lexical and hybrid cache entries isolated', async () => {
  const restoreFetch = installEmbeddingFetchMock([
    { match: 'branch handoff summary with audit notes and parent topic checklist', embedding: [0.6, 0.4, 0] },
    { match: 'branch handoff summary', embedding: [1, 0, 0] },
  ]);
  const database = await createSearchDatabase();

  try {
    database.run(`
      CREATE VIRTUAL TABLE document_chunks_fts USING fts5(
        chunk_id UNINDEXED,
        document_id UNINDEXED,
        title,
        content
      );
    `);

    database.run(
      'INSERT INTO documents (id, title, content) VALUES (?, ?, ?)',
      [
        'doc_cache',
        'Branch Handoff Summary',
        'branch handoff summary with audit notes and parent topic checklist',
      ],
    );
    indexDocumentChunks(database, {
      id: 'doc_cache',
      title: 'Branch Handoff Summary',
      content: 'branch handoff summary with audit notes and parent topic checklist',
    });

    await searchDocumentsInDatabase(database, 'branch handoff summary');
    await searchDocumentsInDatabase(database, 'branch handoff summary', {
      embeddingConfig: TEST_EMBEDDING_CONFIG,
    });

    const cacheKeys = database
      .exec('SELECT cache_key FROM document_search_cache ORDER BY cache_key ASC')[0]
      ?.values.map((row) => String(row[0])) ?? [];

    assert.equal(cacheKeys.length, 2);
    assert.ok(cacheKeys.some((key) => key.endsWith('::lexical')));
    assert.ok(cacheKeys.some((key) => key.includes('::hybrid::text-embedding-test')));
  } finally {
    restoreFetch();
    database.close();
  }
});

test('searchDocumentsInDatabase adds corrective retrieval results when the primary pass is sparse', async () => {
  const database = await createSearchDatabase();

  try {
    database.run(`
      CREATE VIRTUAL TABLE document_chunks_fts USING fts5(
        chunk_id UNINDEXED,
        document_id UNINDEXED,
        title,
        content
      );
    `);

    database.run(
      'INSERT INTO documents (id, title, content) VALUES (?, ?, ?)',
      [
        'doc_primary',
        'Branch Return Guide',
        'Branch handoff summary with audit notes. Use `parent_topic_id` to send findings back to the parent thread.',
      ],
    );
    database.run(
      'INSERT INTO documents (id, title, content) VALUES (?, ?, ?)',
      [
        'doc_corrective',
        'Parent Topic Id API',
        '`parent_topic_id` stores the upstream topic identifier used by branch metadata records.',
      ],
    );

    indexDocumentChunks(database, {
      id: 'doc_primary',
      title: 'Branch Return Guide',
      content:
        'Branch handoff summary with audit notes. Use `parent_topic_id` to send findings back to the parent thread.',
    });
    indexDocumentChunks(database, {
      id: 'doc_corrective',
      title: 'Parent Topic Id API',
      content: '`parent_topic_id` stores the upstream topic identifier used by branch metadata records.',
    });

    const results = await searchDocumentsInDatabase(database, 'return branch findings');

    assert.equal(results[0]?.id, 'doc_primary');
    assert.ok(results.some((result) => result.id === 'doc_corrective'));
    assert.notEqual(
      results.find((result) => result.id === 'doc_corrective')?.retrievalStage,
      'primary',
    );
  } finally {
    database.close();
  }
});

test('searchDocumentsInDatabase uses graph-neighborhood expansion to surface second-order matches', async () => {
  const database = await createSearchDatabase();

  try {
    database.run(`
      CREATE VIRTUAL TABLE document_chunks_fts USING fts5(
        chunk_id UNINDEXED,
        document_id UNINDEXED,
        title,
        content
      );
    `);

    database.run(
      'INSERT INTO documents (id, title, content) VALUES (?, ?, ?)',
      [
        'doc_bridge',
        'Branch Handoff Guide',
        'Branch handoff uses `parent_topic_id` to connect child results to the upstream thread.',
      ],
    );
    database.run(
      'INSERT INTO documents (id, title, content) VALUES (?, ?, ?)',
      [
        'doc_neighbor',
        'Parent Topic Id Reference',
        '`parent_topic_id` stores the upstream topic identifier for branch metadata.',
      ],
    );

    indexDocumentChunks(database, {
      id: 'doc_bridge',
      title: 'Branch Handoff Guide',
      content: 'Branch handoff uses `parent_topic_id` to connect child results to the upstream thread.',
    });
    indexDocumentChunks(database, {
      id: 'doc_neighbor',
      title: 'Parent Topic Id Reference',
      content: '`parent_topic_id` stores the upstream topic identifier for branch metadata.',
    });

    const results = await searchDocumentsInDatabase(database, 'branch handoff');
    const neighborResult = results.find((result) => result.id === 'doc_neighbor');

    assert.ok(neighborResult);
    assert.ok((neighborResult?.graphExpansionHints?.length ?? 0) > 0);
    assert.ok((neighborResult?.graphPaths?.length ?? 0) > 0);
  } finally {
    database.close();
  }
});

test('searchDocumentsInDatabase carries two-hop graph paths into results', async () => {
  const database = await createSearchDatabase();

  try {
    database.run(`
      CREATE VIRTUAL TABLE document_chunks_fts USING fts5(
        chunk_id UNINDEXED,
        document_id UNINDEXED,
        title,
        content
      );
    `);

    database.run(
      'INSERT INTO documents (id, title, content) VALUES (?, ?, ?)',
      [
        'doc_bridge',
        'Branch Handoff Guide',
        'Branch handoff uses `parent_topic_id` to route findings to the parent thread.',
      ],
    );
    database.run(
      'INSERT INTO documents (id, title, content) VALUES (?, ?, ?)',
      [
        'doc_link',
        'Parent Topic Id Audit Link',
        '`parent_topic_id` connects to `review_audit_record` entries used for review metadata.',
      ],
    );
    database.run(
      'INSERT INTO documents (id, title, content) VALUES (?, ?, ?)',
      [
        'doc_target',
        'Handoff Audit Reference',
        '`review_audit_record` stores review status for approval workflows.',
      ],
    );

    indexDocumentChunks(database, {
      id: 'doc_bridge',
      title: 'Branch Handoff Guide',
      content: 'Branch handoff uses `parent_topic_id` to route findings to the parent thread.',
    });
    indexDocumentChunks(database, {
      id: 'doc_link',
      title: 'Parent Topic Id Audit Link',
      content: '`parent_topic_id` connects to `review_audit_record` entries used for review metadata.',
    });
    indexDocumentChunks(database, {
      id: 'doc_target',
      title: 'Handoff Audit Reference',
      content: '`review_audit_record` stores review status for approval workflows.',
    });

    const results = await searchDocumentsInDatabase(database, 'branch handoff');
    const targetResult = results.find((result) => result.id === 'doc_target');

    assert.ok(targetResult);
    assert.ok((targetResult?.graphExpansionHints ?? []).includes('review audit record'));
    assert.ok(
      (targetResult?.graphPaths ?? []).some(
        (path) => path.includes('parent topic id') && path.includes('review audit record'),
      ),
    );
  } finally {
    database.close();
  }
});
