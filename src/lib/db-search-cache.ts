import type { Database } from './db-core';
import { mapRows } from './db-row-helpers';
import type { KnowledgeDocumentSearchMetrics, RetrievedDocumentResult } from './db-types';

function nowIso(): string {
  return new Date().toISOString();
}

export function createEmptyKnowledgeSearchMetrics(): KnowledgeDocumentSearchMetrics {
  return {
    cacheHit: false,
    expandedQueryCount: 0,
    subqueryCount: 0,
    primaryCandidateCount: 0,
    correctiveQueryCount: 0,
    correctiveCandidateCount: 0,
    lexicalDurationMs: 0,
    vectorDurationMs: 0,
    graphDurationMs: 0,
    rerankDurationMs: 0,
    correctiveDurationMs: 0,
    totalDurationMs: 0,
  };
}

export function clearDocumentSearchCache(database: Database) {
  database.run('DELETE FROM document_search_cache');
}

export function readDocumentSearchCache(database: Database, cacheKey: string): RetrievedDocumentResult[] | null {
  const row = mapRows<{ results_json: string }>(
    database.exec(
      `
        SELECT results_json
        FROM document_search_cache
        WHERE cache_key = ?
        LIMIT 1
      `,
      [cacheKey],
    ),
  )[0];

  if (!row) {
    return null;
  }

  try {
    return JSON.parse(row.results_json) as RetrievedDocumentResult[];
  } catch (error) {
    console.warn(`Failed to parse document search cache for "${cacheKey}"; recomputing results:`, error);
    return null;
  }
}

export function writeDocumentSearchCache(
  database: Database,
  cacheKey: string,
  query: string,
  results: { id: string; title: string; content: string }[],
) {
  const timestamp = nowIso();
  database.run(
    `
      INSERT INTO document_search_cache (cache_key, query, results_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
        query = excluded.query,
        results_json = excluded.results_json,
        updated_at = excluded.updated_at
    `,
    [cacheKey, query, JSON.stringify(results), timestamp],
  );
}
