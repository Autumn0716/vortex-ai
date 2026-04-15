import type { Database, SqlValue } from './db-core';
import { mapRows } from './db-row-helpers';
import type {
  KnowledgeDocumentRecord,
  KnowledgeDocumentSearchOptions,
  KnowledgeDocumentSearchResult,
  RetrievedDocumentResult,
} from './db-types';
import { normalizeKnowledgeTags, type KnowledgeDocumentSourceType } from './knowledge-document-model';

export function parseKnowledgeTags(raw: unknown, context: string) {
  if (typeof raw !== 'string' || !raw.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? normalizeKnowledgeTags(parsed) : [];
  } catch (error) {
    console.warn(`Failed to parse knowledge document tags for ${context}; falling back to empty tags:`, error);
    return [];
  }
}

export function getDocumentMetadataRecord(database: Database, documentId: string): KnowledgeDocumentRecord | null {
  const row = mapRows<{
    id: string;
    title: string;
    content: string;
    source_type: KnowledgeDocumentSourceType;
    source_uri: string | null;
    tags_json: string;
    synced_at: string | null;
    updated_at: string;
  }>(
    database.exec(
      `
        SELECT
          d.id,
          d.title,
          d.content,
          m.source_type,
          m.source_uri,
          m.tags_json,
          m.synced_at,
          m.updated_at
        FROM documents d
        LEFT JOIN document_metadata m ON m.document_id = d.id
        WHERE d.id = ?
        LIMIT 1
      `,
      [documentId],
    ),
  )[0];

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    title: row.title,
    content: row.content,
    sourceType: row.source_type ?? 'user_upload',
    sourceUri: row.source_uri ?? undefined,
    tags: parseKnowledgeTags(row.tags_json, `"${documentId}"`),
    syncedAt: row.synced_at ?? undefined,
    updatedAt: row.updated_at,
  };
}

export function mergeSearchResultWithMetadata(
  record: KnowledgeDocumentRecord | null,
  result: RetrievedDocumentResult,
): KnowledgeDocumentSearchResult | null {
  if (!record) {
    return null;
  }

  return {
    ...record,
    title: result.title || record.title,
    content: result.content || record.content,
    supportScore: result.supportScore,
    supportLabel: result.supportLabel,
    matchedTerms: result.matchedTerms,
    graphHints: result.graphHints,
    graphExpansionHints: result.graphExpansionHints,
    retrievalStage: result.retrievalStage,
  };
}

export function matchesKnowledgeDocumentFilters(
  record: Pick<KnowledgeDocumentRecord, 'sourceType' | 'sourceUri'> | null,
  options?: Pick<KnowledgeDocumentSearchOptions, 'sourceTypes' | 'sourceUriPrefixes'>,
) {
  if (!record) {
    return !options?.sourceTypes?.length && !options?.sourceUriPrefixes?.length;
  }

  if (options?.sourceTypes?.length && !options.sourceTypes.includes(record.sourceType)) {
    return false;
  }

  if (options?.sourceUriPrefixes?.length) {
    const sourceUri = (record.sourceUri ?? '').toLowerCase();
    if (!options.sourceUriPrefixes.some((prefix) => sourceUri.startsWith(prefix.toLowerCase()))) {
      return false;
    }
  }

  return true;
}

export function readDocumentSourceTypeMap(database: Database) {
  return new Map(
    mapRows<{ document_id: string; source_type: KnowledgeDocumentSourceType | null }>(
      database.exec('SELECT document_id, source_type FROM document_metadata'),
    ).map((row) => [row.document_id, row.source_type ?? 'user_upload']),
  );
}

export function buildKnowledgeDocumentFilterSql(
  options?: Pick<KnowledgeDocumentSearchOptions, 'sourceTypes' | 'sourceUriPrefixes'>,
) {
  const clauses: string[] = [];
  const params: SqlValue[] = [];
  const requiresMetadataJoin = Boolean(options?.sourceTypes?.length || options?.sourceUriPrefixes?.length);

  if (options?.sourceTypes?.length) {
    clauses.push(`m.source_type IN (${options.sourceTypes.map(() => '?').join(', ')})`);
    params.push(...options.sourceTypes);
  }

  if (options?.sourceUriPrefixes?.length) {
    clauses.push(
      `(${options.sourceUriPrefixes.map(() => "LOWER(COALESCE(m.source_uri, '')) LIKE ?").join(' OR ')})`,
    );
    params.push(...options.sourceUriPrefixes.map((prefix) => `${prefix.toLowerCase()}%`));
  }

  return {
    joinSql: requiresMetadataJoin ? 'JOIN document_metadata m ON m.document_id = d.id' : '',
    whereSql: clauses.length > 0 ? ` AND ${clauses.join(' AND ')}` : '',
    params,
  };
}

export function getSourceTypeWeight(sourceType: KnowledgeDocumentSourceType | undefined, options?: KnowledgeDocumentSearchOptions) {
  if (!sourceType) {
    return 1;
  }

  const weight = options?.searchWeights?.sourceTypeWeights?.[sourceType];
  return typeof weight === 'number' && Number.isFinite(weight) && weight >= 0 ? weight : 1;
}
