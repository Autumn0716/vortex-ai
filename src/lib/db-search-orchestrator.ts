import type { Database } from './db-core';
import {
  createEmptyKnowledgeSearchMetrics,
  readDocumentSearchCache,
  writeDocumentSearchCache,
} from './db-search-cache';
import {
  collectDocumentCandidates,
  mergeDocumentSearchCandidate,
  shapeRetrievedDocumentResults,
} from './db-search-pipeline';
import type {
  DocumentSearchCandidate,
  KnowledgeDocumentSearchMetrics,
  KnowledgeDocumentSearchOptions,
  RetrievedDocumentResult,
} from './db-types';
import {
  decomposeTaskQuery,
  expandKnowledgeSearchQueries,
  planCorrectiveKnowledgeQueries,
} from './local-rag-helpers';

export async function searchDocumentsInDatabase(
  database: Database,
  query: string,
  options?: KnowledgeDocumentSearchOptions,
): Promise<RetrievedDocumentResult[]> {
  return (await searchDocumentsInDatabaseWithMetrics(database, query, options)).results;
}

export async function searchDocumentsInDatabaseWithMetrics(
  database: Database,
  query: string,
  options?: KnowledgeDocumentSearchOptions,
): Promise<{ results: RetrievedDocumentResult[]; metrics: KnowledgeDocumentSearchMetrics }> {
  const totalStartedAt = Date.now();
  const metrics = createEmptyKnowledgeSearchMetrics();
  try {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      metrics.totalDurationMs = Date.now() - totalStartedAt;
      return { results: [], metrics };
    }

    const expandedQueries = expandKnowledgeSearchQueries(normalizedQuery);
    metrics.expandedQueryCount = expandedQueries.length;
    const baseCacheKey = expandedQueries.join('::');
    if (!baseCacheKey) {
      metrics.totalDurationMs = Date.now() - totalStartedAt;
      return { results: [], metrics };
    }
    const cacheKey = options?.embeddingConfig
      ? `${baseCacheKey}::hybrid::${options.embeddingConfig.model}`
      : `${baseCacheKey}::lexical`;
    const scopedCacheKey = [
      cacheKey,
      options?.sourceTypes?.length ? `types=${options.sourceTypes.join(',')}` : '',
      options?.sourceUriPrefixes?.length ? `uris=${options.sourceUriPrefixes.join(',')}` : '',
      options?.searchWeights
        ? `weights=${options.searchWeights.lexicalWeight ?? ''},${options.searchWeights.vectorWeight ?? ''},${options.searchWeights.graphWeight ?? ''},sources=${Object.entries(options.searchWeights.sourceTypeWeights ?? {})
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([sourceType, weight]) => `${sourceType}:${weight}`)
            .join('|')}`
        : '',
    ]
      .filter(Boolean)
      .join('::');

    const cached = readDocumentSearchCache(database, scopedCacheKey);
    if (cached) {
      metrics.cacheHit = true;
      metrics.totalDurationMs = Date.now() - totalStartedAt;
      return { results: cached, metrics };
    }

    const subqueries = expandedQueries.length > 0 ? expandedQueries : decomposeTaskQuery(normalizedQuery);
    metrics.subqueryCount = subqueries.length;
    const primaryCollection = await collectDocumentCandidates(database, normalizedQuery, subqueries, options);
    const primaryCandidates = primaryCollection.candidates;
    metrics.primaryCandidateCount = primaryCandidates.length;
    metrics.lexicalDurationMs += primaryCollection.metrics.lexicalDurationMs;
    metrics.vectorDurationMs += primaryCollection.metrics.vectorDurationMs;
    metrics.graphDurationMs += primaryCollection.metrics.graphDurationMs;
    const retrievalStages = new Map<string, 'primary' | 'corrective' | 'hybrid'>(
      primaryCandidates.map((candidate) => [candidate.id, 'primary']),
    );

    const rerankStartedAt = Date.now();
    const primaryResults = shapeRetrievedDocumentResults(normalizedQuery, primaryCandidates, options, retrievalStages);
    metrics.rerankDurationMs += Date.now() - rerankStartedAt;
    const correctivePlan = planCorrectiveKnowledgeQueries(normalizedQuery, primaryResults, options);
    metrics.correctiveQueryCount = correctivePlan.queries.length;

    let finalResults = primaryResults;
    if (correctivePlan.queries.length > 0) {
      const correctiveStartedAt = Date.now();
      const correctiveCollection = await collectDocumentCandidates(
        database,
        correctivePlan.queries.join(' '),
        correctivePlan.queries,
        options,
      );
      const correctiveCandidates = correctiveCollection.candidates;
      metrics.correctiveCandidateCount = correctiveCandidates.length;
      metrics.lexicalDurationMs += correctiveCollection.metrics.lexicalDurationMs;
      metrics.vectorDurationMs += correctiveCollection.metrics.vectorDurationMs;
      metrics.graphDurationMs += correctiveCollection.metrics.graphDurationMs;

      if (correctiveCandidates.length > 0) {
        const merged = new Map<string, DocumentSearchCandidate>(
          primaryCandidates.map((candidate) => [candidate.id, { ...candidate, graphHints: [...(candidate.graphHints ?? [])] }]),
        );

        correctiveCandidates.forEach((candidate) => {
          const existing = merged.get(candidate.id);
          if (existing) {
            mergeDocumentSearchCandidate(merged, candidate);
            retrievalStages.set(candidate.id, 'hybrid');
            return;
          }

          merged.set(candidate.id, {
            ...candidate,
            graphHints: [...(candidate.graphHints ?? [])],
          });
          retrievalStages.set(candidate.id, 'corrective');
        });

        const correctiveRerankStartedAt = Date.now();
        finalResults = shapeRetrievedDocumentResults(
          normalizedQuery,
          [...merged.values()],
          options,
          retrievalStages,
        );
        metrics.rerankDurationMs += Date.now() - correctiveRerankStartedAt;
      }
      metrics.correctiveDurationMs += Date.now() - correctiveStartedAt;
    }

    writeDocumentSearchCache(database, scopedCacheKey, normalizedQuery, finalResults);
    metrics.totalDurationMs = Date.now() - totalStartedAt;
    return { results: finalResults, metrics };
  } catch (error) {
    console.error('Search error:', error);
    metrics.totalDurationMs = Date.now() - totalStartedAt;
    return { results: [], metrics };
  }
}
