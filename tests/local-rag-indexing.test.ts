import test from 'node:test';
import assert from 'node:assert/strict';
import initSqlite from '@sqlite.org/sqlite-wasm';
import {
  Database,
  clearDocumentSearchCache,
  getDocumentFtsEnabled,
  indexDocumentChunks,
  searchKnowledgeDocuments,
  searchDocumentsInDatabase,
} from '../src/lib/db';

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
  } finally {
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
  } finally {
    database.close();
  }
});
