import { getAgentConfig } from './agent/config';
import { buildEmbeddingConfigFromDocuments, parseEmbeddingJson } from './db';
import type { Database } from './db';
import { createEmbeddings, type EmbeddingProviderConfig } from './embedding-client';
import { routeMemoryQuery, type MemoryRetrievalLayer } from './memory-lifecycle/query-router';
import { cosineSimilarity } from './vector-search-model';
import { mapRows } from './agent-workspace-queries';
import { resolveMemoryTier, type MemoryTierPolicy } from './agent-memory-model';
import type {
  AgentMemoryDocument,
  AgentMemorySearchResult,
} from './agent-workspace-types';

const MAX_COLD_MEMORY_VECTOR_HITS = 3;

export function getMemoryDocumentLayer(
  document: Pick<AgentMemoryDocument, 'memoryScope' | 'updatedAt'>,
  now: string,
  tierPolicy?: MemoryTierPolicy,
): MemoryRetrievalLayer {
  if (document.memoryScope === 'global') {
    return 'global';
  }

  return resolveMemoryTier(document.updatedAt, now, tierPolicy);
}

export function selectMemoryDocumentsByLayers(
  documents: AgentMemoryDocument[],
  layers: MemoryRetrievalLayer[],
  now: string,
  tierPolicy?: MemoryTierPolicy,
) {
  const allowedLayers = new Set(layers);
  return documents.filter((document) => allowedLayers.has(getMemoryDocumentLayer(document, now, tierPolicy)));
}

export function countNonGlobalMemoryDocuments(documents: AgentMemoryDocument[]) {
  return documents.reduce((count, document) => count + (document.memoryScope === 'global' ? 0 : 1), 0);
}

export function mergeDistinctMemorySearchResults(...groups: AgentMemorySearchResult[][]) {
  const merged: AgentMemorySearchResult[] = [];
  const seen = new Set<string>();

  groups.flat().forEach((result) => {
    if (seen.has(result.id)) {
      return;
    }

    seen.add(result.id);
    merged.push(result);
  });

  return merged;
}

export function scoreMemorySearchResult(document: AgentMemoryDocument, query?: string) {
  const baseScore = document.importanceScore;
  if (!query?.trim()) {
    return baseScore;
  }

  const terms = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .filter((term) => term.length > 1);
  if (terms.length === 0) {
    return baseScore;
  }

  const haystack = `${document.title}\n${document.content}`.toLowerCase();
  const matchScore = terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
  return baseScore + matchScore;
}

export function toMemorySearchResults(
  documents: AgentMemoryDocument[],
  stage: AgentMemorySearchResult['retrievalStage'],
  now: string,
  query?: string,
  tierPolicy?: MemoryTierPolicy,
): AgentMemorySearchResult[] {
  return documents
    .map((document) => ({
      ...document,
      layer: getMemoryDocumentLayer(document, now, tierPolicy),
      retrievalStage: stage,
      score: scoreMemorySearchResult(document, query),
    }))
    .sort((left, right) => right.score - left.score || right.updatedAt.localeCompare(left.updatedAt));
}

export async function resolveMemoryEmbeddingConfig(override?: EmbeddingProviderConfig | null) {
  if (override !== undefined) {
    return override;
  }

  const config = await getAgentConfig();
  return buildEmbeddingConfigFromDocuments(config.documents);
}

export async function searchColdMemoryVectorDocuments(
  database: Database,
  agentId: string,
  documents: AgentMemoryDocument[],
  query: string,
  now: string,
  embeddingConfig?: EmbeddingProviderConfig | null,
  tierPolicy?: MemoryTierPolicy,
) {
  const coldDocuments = documents.filter((document) => getMemoryDocumentLayer(document, now, tierPolicy) === 'cold');
  if (coldDocuments.length === 0) {
    return [];
  }

  const resolvedEmbeddingConfig = await resolveMemoryEmbeddingConfig(embeddingConfig);
  if (!resolvedEmbeddingConfig) {
    return [];
  }

  try {
    const embeddingResponse = await createEmbeddings(query, resolvedEmbeddingConfig);
    const queryEmbedding = embeddingResponse.data[0]?.embedding;
    if (!Array.isArray(queryEmbedding) || queryEmbedding.length === 0) {
      return [];
    }

    const rows = mapRows<{
      memory_document_id: string;
      embedding_json: string;
    }>(
      database.exec(
        `
          SELECT memory_document_id, embedding_json
          FROM agent_memory_embeddings
          WHERE agent_id = ?
            AND source_type = 'cold_summary'
        `,
        [agentId],
      ),
    );
    const documentsById = new Map(coldDocuments.map((document) => [document.id, document]));

    return rows
      .map((row) => {
        const document = documentsById.get(row.memory_document_id);
        if (!document) {
          return null;
        }

        return {
          document,
          score: cosineSimilarity(queryEmbedding, parseEmbeddingJson(row.embedding_json)),
        };
      })
      .filter((row): row is { document: AgentMemoryDocument; score: number } => Boolean(row && row.score > 0))
      .sort((left, right) => right.score - left.score)
      .slice(0, MAX_COLD_MEMORY_VECTOR_HITS)
      .map((row) => row.document);
  } catch (error) {
    console.warn('Cold memory vector retrieval failed, falling back to routed memory documents:', error);
    return [];
  }
}

export { routeMemoryQuery };
