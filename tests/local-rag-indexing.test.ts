import test from 'node:test';
import assert from 'node:assert/strict';
import initSqlite from '@sqlite.org/sqlite-wasm';
import {
  Database,
  clearDocumentSearchCache,
  getDocumentFtsEnabled,
  indexDocumentChunks,
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
