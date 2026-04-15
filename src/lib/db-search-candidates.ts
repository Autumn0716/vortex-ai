import type { Database } from './db-core';
import { parseEmbeddingJson } from './db-embeddings';
import { matchesKnowledgeDocumentFilters } from './db-knowledge-documents';
import { mapRows } from './db-row-helpers';
import type { DocumentChunkEmbeddingRow, KnowledgeDocumentSearchOptions } from './db-types';
import { extractKnowledgeGraphEntities } from './local-rag-helpers';
import { cosineSimilarity } from './vector-search-model';
import type { KnowledgeDocumentSourceType } from './knowledge-document-model';

export async function readVectorCandidates(
  database: Database,
  queryEmbedding: number[],
  options?: Pick<KnowledgeDocumentSearchOptions, 'sourceTypes' | 'sourceUriPrefixes'>,
): Promise<Array<{ id: string; title: string; content: string; vectorScore: number }>> {
  const rows = mapRows<DocumentChunkEmbeddingRow>(
    database.exec(
      `
        SELECT
          e.chunk_id,
          e.document_id,
          c.content,
          e.embedding_json
        FROM document_chunk_embeddings e
        JOIN document_chunks c ON c.id = e.chunk_id
      `,
    ),
  );

  const scored = new Map<string, { id: string; title: string; content: string; vectorScore: number }>();
  const titles = new Map(
    mapRows<{ id: string; title: string }>(database.exec('SELECT id, title FROM documents')).map((row) => [
      row.id,
      row.title,
    ]),
  );
  const metadataById = new Map(
    mapRows<{ document_id: string; source_type: KnowledgeDocumentSourceType | null; source_uri: string | null }>(
      database.exec('SELECT document_id, source_type, source_uri FROM document_metadata'),
    ).map((row) => [
      row.document_id,
      {
        sourceType: row.source_type ?? 'user_upload',
        sourceUri: row.source_uri ?? undefined,
      },
    ]),
  );

  rows.forEach((row) => {
    if (!matchesKnowledgeDocumentFilters(metadataById.get(row.document_id) ?? null, options)) {
      return;
    }

    const embedding = parseEmbeddingJson(row.embedding_json);
    const similarity = cosineSimilarity(queryEmbedding, embedding);
    if (similarity <= 0) {
      return;
    }

    const existing = scored.get(row.document_id);
    if (!existing || similarity > existing.vectorScore) {
      scored.set(row.document_id, {
        id: row.document_id,
        title: titles.get(row.document_id) ?? row.document_id,
        content: row.content,
        vectorScore: similarity,
      });
    }
  });

  return [...scored.values()].sort((left, right) => right.vectorScore - left.vectorScore).slice(0, 8);
}

export function readGraphCandidates(
  database: Database,
  query: string,
  options?: Pick<KnowledgeDocumentSearchOptions, 'sourceTypes' | 'sourceUriPrefixes'>,
): Array<{
  id: string;
  title: string;
  content: string;
  graphScore: number;
  graphHints: string[];
  graphExpansionHints: string[];
  graphPaths: string[];
}> {
  const queryEntities = extractKnowledgeGraphEntities(query, 8).map((entry) => entry.normalizedEntity);
  if (queryEntities.length === 0) {
    return [];
  }

  const metadataById = new Map(
    mapRows<{ document_id: string; source_type: KnowledgeDocumentSourceType | null; source_uri: string | null }>(
      database.exec('SELECT document_id, source_type, source_uri FROM document_metadata'),
    ).map((row) => [
      row.document_id,
      {
        sourceType: row.source_type ?? 'user_upload',
        sourceUri: row.source_uri ?? undefined,
      },
    ]),
  );

  const edgeRows = mapRows<{
    source_entity: string;
    target_entity: string;
    relation: string;
    weight: number;
  }>(
    database.exec(
      `
        SELECT source_entity, target_entity, relation, weight
        FROM document_graph_edges
      `,
    ),
  );

  const queryEntitySet = new Set(queryEntities);
  const firstHopWeights = new Map<string, number>();
  const firstHopPaths = new Map<string, string[]>();
  const pushPath = (target: Map<string, string[]>, entity: string, path: string) => {
    const current = target.get(entity) ?? [];
    if (!current.includes(path)) {
      current.push(path);
      target.set(entity, current.slice(0, 4));
    }
  };

  edgeRows.forEach((row) => {
    if (queryEntitySet.has(row.source_entity) && !queryEntitySet.has(row.target_entity)) {
      firstHopWeights.set(
        row.target_entity,
        Math.max(firstHopWeights.get(row.target_entity) ?? 0, row.weight * 0.45),
      );
      pushPath(firstHopPaths, row.target_entity, `${row.source_entity} -${row.relation}-> ${row.target_entity}`);
    }
    if (queryEntitySet.has(row.target_entity) && !queryEntitySet.has(row.source_entity)) {
      firstHopWeights.set(
        row.source_entity,
        Math.max(firstHopWeights.get(row.source_entity) ?? 0, row.weight * 0.45),
      );
      pushPath(firstHopPaths, row.source_entity, `${row.target_entity} -${row.relation}-> ${row.source_entity}`);
    }
  });

  const boundedFirstHopEntities = [...firstHopWeights.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 6);
  const firstHopEntityScores = new Map(boundedFirstHopEntities);
  const firstHopEntitySet = new Set(firstHopEntityScores.keys());

  const secondHopWeights = new Map<string, number>();
  const secondHopPaths = new Map<string, string[]>();
  edgeRows.forEach((row) => {
    const traverse = (sourceEntity: string, targetEntity: string) => {
      if (!firstHopEntitySet.has(sourceEntity) || queryEntitySet.has(targetEntity) || firstHopEntitySet.has(targetEntity)) {
        return;
      }
      const sourceWeight = firstHopEntityScores.get(sourceEntity) ?? 0;
      if (sourceWeight <= 0) {
        return;
      }
      secondHopWeights.set(
        targetEntity,
        Math.max(secondHopWeights.get(targetEntity) ?? 0, Number((sourceWeight * row.weight * 0.72).toFixed(3))),
      );
      const seedPaths = firstHopPaths.get(sourceEntity) ?? [];
      if (seedPaths.length === 0) {
        pushPath(secondHopPaths, targetEntity, `${sourceEntity} -${row.relation}-> ${targetEntity}`);
        return;
      }
      seedPaths.forEach((seedPath) => {
        pushPath(secondHopPaths, targetEntity, `${seedPath} -${row.relation}-> ${targetEntity}`);
      });
    };

    traverse(row.source_entity, row.target_entity);
    traverse(row.target_entity, row.source_entity);
  });

  const boundedSecondHopEntities = [...secondHopWeights.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 6);
  const secondHopEntityScores = new Map(boundedSecondHopEntities);

  const rows = mapRows<{
    document_id: string;
    title: string;
    content: string;
    normalized_entity: string;
    weight: number;
  }>(
    database.exec(
      `
        SELECT
          d.id AS document_id,
          d.title,
          d.content,
          g.normalized_entity,
          g.weight
        FROM document_graph_nodes g
        JOIN documents d ON d.id = g.document_id
      `,
    ),
  );

  const scored = new Map<
    string,
    {
      id: string;
      title: string;
      content: string;
      directGraphScore: number;
      firstHopGraphScore: number;
      secondHopGraphScore: number;
      graphHints: string[];
      graphExpansionHints: string[];
      graphPaths: string[];
    }
  >();
  rows.forEach((row) => {
    if (!matchesKnowledgeDocumentFilters(metadataById.get(row.document_id) ?? null, options)) {
      return;
    }

    const directMatch = queryEntitySet.has(row.normalized_entity);
    const firstHopWeight = firstHopEntityScores.get(row.normalized_entity) ?? 0;
    const secondHopWeight = secondHopEntityScores.get(row.normalized_entity) ?? 0;
    if (!directMatch && firstHopWeight <= 0 && secondHopWeight <= 0) {
      return;
    }

    const existing = scored.get(row.document_id);
    if (existing) {
      if (directMatch) {
        existing.directGraphScore += row.weight;
      }
      if (firstHopWeight > 0) {
        existing.firstHopGraphScore += firstHopWeight;
      }
      if (secondHopWeight > 0) {
        existing.secondHopGraphScore += secondHopWeight;
      }
      if (directMatch && !existing.graphHints.includes(row.normalized_entity)) {
        existing.graphHints.push(row.normalized_entity);
      }
      if ((firstHopWeight > 0 || secondHopWeight > 0) && !existing.graphExpansionHints.includes(row.normalized_entity)) {
        existing.graphExpansionHints.push(row.normalized_entity);
      }
      [...(firstHopPaths.get(row.normalized_entity) ?? []), ...(secondHopPaths.get(row.normalized_entity) ?? [])].forEach((path) => {
        if (!existing.graphPaths.includes(path)) {
          existing.graphPaths.push(path);
        }
      });
      return;
    }

    scored.set(row.document_id, {
      id: row.document_id,
      title: row.title,
      content: row.content,
      directGraphScore: directMatch ? row.weight : 0,
      firstHopGraphScore: firstHopWeight,
      secondHopGraphScore: secondHopWeight,
      graphHints: directMatch ? [row.normalized_entity] : [],
      graphExpansionHints: firstHopWeight > 0 || secondHopWeight > 0 ? [row.normalized_entity] : [],
      graphPaths: [...(firstHopPaths.get(row.normalized_entity) ?? []), ...(secondHopPaths.get(row.normalized_entity) ?? [])].slice(0, 4),
    });
  });

  return [...scored.values()]
    .map((entry) => ({
      ...entry,
      graphScore: Number(
        Math.min(
          1,
          entry.directGraphScore / Math.max(1, queryEntities.length) +
            Math.min(0.28, entry.firstHopGraphScore / Math.max(1, firstHopEntityScores.size || 1)) +
            Math.min(0.18, entry.secondHopGraphScore / Math.max(1, secondHopEntityScores.size || 1)),
        ).toFixed(3),
      ),
      graphHints: entry.graphHints.slice(0, 6),
      graphExpansionHints: entry.graphExpansionHints.slice(0, 6),
      graphPaths: entry.graphPaths.slice(0, 4),
    }))
    .sort((left, right) => right.graphScore - left.graphScore)
    .slice(0, 8);
}
