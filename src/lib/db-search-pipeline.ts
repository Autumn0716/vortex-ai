import type { Database } from './db-core';
import { ensureDocumentEmbeddings } from './db-embeddings';
import { getDocumentFtsEnabled } from './db-document-indexing';
import {
  buildKnowledgeDocumentFilterSql,
  getSourceTypeWeight,
  readDocumentSourceTypeMap,
} from './db-knowledge-documents';
import { readDocumentQualityScoreMap } from './db-document-quality';
import { mapRows } from './db-row-helpers';
import { readGraphCandidates, readVectorCandidates } from './db-search-candidates';
import type {
  CandidateCollectionMetrics,
  DocumentSearchCandidate,
  DocumentSearchRow,
  KnowledgeDocumentSearchOptions,
  RetrievedDocumentResult,
} from './db-types';
import { createEmbeddings } from './embedding-client';
import {
  buildSemanticCacheKey,
  compressRetrievedContext,
  scoreRetrievedContextSupport,
} from './local-rag-helpers';
import { hybridScoreDocuments, rerankHybridDocuments } from './vector-search-model';

function buildFtsMatchQuery(query: string): string {
  return buildSemanticCacheKey(query)
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .map((part) => `"${part}"*`)
    .join(' OR ');
}

export function mergeDocumentSearchCandidate(
  seen: Map<string, DocumentSearchCandidate>,
  candidate: DocumentSearchCandidate,
) {
  const existing = seen.get(candidate.id);
  if (!existing) {
    seen.set(candidate.id, {
      ...candidate,
      graphHints: [...(candidate.graphHints ?? [])],
      graphExpansionHints: [...(candidate.graphExpansionHints ?? [])],
      graphPaths: [...(candidate.graphPaths ?? [])],
    });
    return;
  }

  existing.lexicalScore = Math.min(
    existing.lexicalScore ?? Number.POSITIVE_INFINITY,
    candidate.lexicalScore ?? Number.POSITIVE_INFINITY,
  );
  if (!Number.isFinite(existing.lexicalScore)) {
    delete existing.lexicalScore;
  }

  existing.vectorScore = Math.max(existing.vectorScore ?? 0, candidate.vectorScore ?? 0) || undefined;
  existing.graphScore = Math.max(existing.graphScore ?? 0, candidate.graphScore ?? 0) || undefined;
  existing.sourceType = existing.sourceType ?? candidate.sourceType;

  if (!existing.content.trim() && candidate.content.trim()) {
    existing.content = candidate.content;
  }

  const graphHints = new Set([...(existing.graphHints ?? []), ...(candidate.graphHints ?? [])]);
  existing.graphHints = [...graphHints].slice(0, 6);
  const graphExpansionHints = new Set([
    ...(existing.graphExpansionHints ?? []),
    ...(candidate.graphExpansionHints ?? []),
  ]);
  existing.graphExpansionHints = [...graphExpansionHints].slice(0, 6);
  const graphPaths = new Set([...(existing.graphPaths ?? []), ...(candidate.graphPaths ?? [])]);
  existing.graphPaths = [...graphPaths].slice(0, 4);
}

export async function collectDocumentCandidates(
  database: Database,
  retrievalQuery: string,
  subqueries: string[],
  options?: KnowledgeDocumentSearchOptions,
): Promise<{ candidates: DocumentSearchCandidate[]; metrics: CandidateCollectionMetrics }> {
  const seen = new Map<string, DocumentSearchCandidate>();
  const ftsEnabled = getDocumentFtsEnabled(database);
  const filter = buildKnowledgeDocumentFilterSql(options);
  const sourceTypeByDocumentId = readDocumentSourceTypeMap(database);
  let lexicalDurationMs = 0;
  let vectorDurationMs = 0;
  let graphDurationMs = 0;

  for (const subquery of subqueries) {
    const lexicalStartedAt = Date.now();
    const matchQuery = buildFtsMatchQuery(subquery);
    if (ftsEnabled && matchQuery) {
      const rows = mapRows<DocumentSearchRow>(
        database.exec(
          `
            SELECT
              d.id,
              d.title,
              c.content,
              bm25(document_chunks_fts, 1.0, 0.6) AS score
            FROM document_chunks_fts
            JOIN document_chunks c ON c.id = document_chunks_fts.chunk_id
            JOIN documents d ON d.id = c.document_id
            ${filter.joinSql}
            WHERE document_chunks_fts MATCH ?
            ${filter.whereSql}
            ORDER BY score ASC
            LIMIT 8
          `,
          [matchQuery, ...filter.params],
        ),
      );

      rows.forEach((row) => {
        mergeDocumentSearchCandidate(seen, {
          id: row.id,
          title: row.title,
          content: row.content,
          lexicalScore: row.score,
          sourceType: sourceTypeByDocumentId.get(row.id),
        });
      });
      lexicalDurationMs += Date.now() - lexicalStartedAt;
      continue;
    }

    const terms = buildSemanticCacheKey(subquery)
      .split(/\s+/)
      .filter((word) => word.length > 0);
    if (terms.length === 0) {
      lexicalDurationMs += Date.now() - lexicalStartedAt;
      continue;
    }

    const conditions = terms.map(() => '(title LIKE ? OR content LIKE ?)').join(' OR ');
    const params = terms.flatMap((word) => [`%${word}%`, `%${word}%`]);
    const rows = mapRows<{ id: string; title: string; content: string }>(
      database.exec(
        `
          SELECT d.id, d.title, d.content
          FROM documents d
          ${filter.joinSql}
          WHERE (${conditions})
          ${filter.whereSql}
          LIMIT 8
        `,
        [...params, ...filter.params],
      ),
    );

    rows.forEach((row, index) => {
      mergeDocumentSearchCandidate(seen, {
        id: row.id,
        title: row.title,
        content: row.content,
        lexicalScore: index + 1,
        sourceType: sourceTypeByDocumentId.get(row.id),
      });
    });
    lexicalDurationMs += Date.now() - lexicalStartedAt;
  }

  if (options?.embeddingConfig) {
    const vectorStartedAt = Date.now();
    try {
      await ensureDocumentEmbeddings(database, options.embeddingConfig);
      const embeddingResponse = await createEmbeddings(retrievalQuery, options.embeddingConfig);
      const queryEmbedding = embeddingResponse.data[0]?.embedding;
      if (Array.isArray(queryEmbedding) && queryEmbedding.length > 0) {
        const vectorCandidates = await readVectorCandidates(database, queryEmbedding, options);
        vectorCandidates.forEach((candidate) =>
          mergeDocumentSearchCandidate(seen, {
            ...candidate,
            sourceType: sourceTypeByDocumentId.get(candidate.id),
          }),
        );
      }
    } catch (error) {
      console.warn('Vector search failed, falling back to lexical results:', error);
    } finally {
      vectorDurationMs += Date.now() - vectorStartedAt;
    }
  }

  const graphStartedAt = Date.now();
  const graphCandidates = readGraphCandidates(database, retrievalQuery, options);
  graphCandidates.forEach((candidate) =>
    mergeDocumentSearchCandidate(seen, {
      ...candidate,
      sourceType: sourceTypeByDocumentId.get(candidate.id),
    }),
  );
  graphDurationMs += Date.now() - graphStartedAt;

  return {
    candidates: [...seen.values()],
    metrics: {
      lexicalDurationMs,
      vectorDurationMs,
      graphDurationMs,
    },
  };
}

export function shapeRetrievedDocumentResults(
  query: string,
  candidates: DocumentSearchCandidate[],
  options?: KnowledgeDocumentSearchOptions,
  retrievalStages?: Map<string, 'primary' | 'corrective' | 'hybrid'>,
  qualityScores?: Map<string, number>,
): RetrievedDocumentResult[] {
  const graphWeight = options?.searchWeights?.graphWeight ?? 0.12;

  return rerankHybridDocuments(hybridScoreDocuments(candidates, options?.searchWeights), query)
    .map((row) => ({
      ...row,
      hybridScore:
        (row.hybridScore + (row.graphScore ?? 0) * graphWeight) *
        getSourceTypeWeight(row.sourceType, options) *
        (0.7 + ((qualityScores?.get(row.id) ?? 70) / 100) * 0.6),
    }))
    .sort((left, right) => right.hybridScore - left.hybridScore)
    .slice(0, options?.maxResults ?? 5)
    .map((row) => {
      const compressedContent = compressRetrievedContext(query, row.content);
      const support = scoreRetrievedContextSupport(query, row.title, compressedContent);
      return {
        id: row.id,
        title: row.title,
        content: compressedContent,
        graphHints: row.graphHints ?? [],
        graphExpansionHints: row.graphExpansionHints ?? [],
        graphPaths: row.graphPaths ?? [],
        supportScore: support.score,
        supportLabel: support.label,
        matchedTerms: support.matchedTerms,
        retrievalStage: retrievalStages?.get(row.id) ?? 'primary',
      };
    });
}

export function readQualityScoresForSearch(database: Database) {
  return readDocumentQualityScoreMap(database);
}
