import {
  clearDocumentChunks,
  clearDocumentGraph,
  indexDocumentChunks,
} from './db-document-indexing';
import {
  deleteDocumentChunkEmbeddings,
  syncDocumentChunkEmbeddings,
} from './db-embeddings';
import {
  getDocumentMetadataRecord,
  parseKnowledgeTags,
} from './db-knowledge-documents';
import { upsertDocumentQualityScore } from './db-document-quality';
import { getScalar, mapRows } from './db-row-helpers';
import { clearDocumentSearchCache } from './db-search-cache';
import type { Database } from './db-core';
import type { KnowledgeDocumentRecord } from './db-types';
import type { EmbeddingProviderConfig } from './embedding-client';
import {
  classifyKnowledgeDocument,
  normalizeKnowledgeTags,
  type KnowledgeDocumentSourceType,
} from './knowledge-document-model';

function nowIso(): string {
  return new Date().toISOString();
}

function upsertDocumentMetadata(
  database: Database,
  record: Pick<KnowledgeDocumentRecord, 'id' | 'sourceType' | 'sourceUri' | 'tags' | 'syncedAt'>,
) {
  const timestamp = nowIso();
  database.run(
    `
      INSERT INTO document_metadata (
        document_id,
        source_type,
        source_uri,
        tags_json,
        synced_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(document_id) DO UPDATE SET
        source_type = excluded.source_type,
        source_uri = excluded.source_uri,
        tags_json = excluded.tags_json,
        synced_at = excluded.synced_at,
        updated_at = excluded.updated_at
    `,
    [
      record.id,
      record.sourceType,
      record.sourceUri ?? null,
      JSON.stringify(normalizeKnowledgeTags(record.tags)),
      record.syncedAt ?? null,
      timestamp,
    ],
  );
}

export async function upsertKnowledgeDocumentInDatabase(
  database: Database,
  record: Pick<KnowledgeDocumentRecord, 'id' | 'title' | 'content'> &
    Partial<Pick<KnowledgeDocumentRecord, 'sourceType' | 'sourceUri' | 'tags' | 'syncedAt'>>,
  options?: { skipEmbeddings?: boolean; embeddingConfig?: EmbeddingProviderConfig | null },
) {
  const derived = classifyKnowledgeDocument({
    title: record.title,
    sourceUri: record.sourceUri,
  });
  const sourceType = record.sourceType ?? derived.sourceType;
  const tags = normalizeKnowledgeTags([...(record.tags ?? []), ...derived.tags]);
  const existing = getDocumentMetadataRecord(database, record.id);

  const isUnchanged =
    existing &&
    existing.title === record.title &&
    existing.content === record.content &&
    existing.sourceType === sourceType &&
    (existing.sourceUri ?? '') === (record.sourceUri ?? '') &&
    JSON.stringify(existing.tags) === JSON.stringify(tags) &&
    (existing.syncedAt ?? '') === (record.syncedAt ?? '');

  if (isUnchanged) {
    return false;
  }

  const exists = Number(getScalar(database, 'SELECT COUNT(*) FROM documents WHERE id = ?', [record.id]) ?? 0);
  if (exists > 0) {
    database.run('UPDATE documents SET title = ?, content = ? WHERE id = ?', [
      record.title,
      record.content,
      record.id,
    ]);
  } else {
    database.run('INSERT INTO documents (id, title, content) VALUES (?, ?, ?)', [
      record.id,
      record.title,
      record.content,
    ]);
  }

  upsertDocumentMetadata(database, {
    id: record.id,
    sourceType,
    sourceUri: record.sourceUri,
    tags,
    syncedAt: record.syncedAt,
  });
  indexDocumentChunks(database, { id: record.id, title: record.title, content: record.content });
  upsertDocumentQualityScore(database, record.id);

  if (!options?.skipEmbeddings) {
    if (options?.embeddingConfig) {
      try {
        await syncDocumentChunkEmbeddings(database, record.id, options.embeddingConfig);
      } catch (error) {
        console.warn('Embedding sync failed, keeping lexical index only:', error);
      }
    } else {
      deleteDocumentChunkEmbeddings(database, record.id);
    }
  }

  clearDocumentSearchCache(database);
  return true;
}

export function getDocumentsInDatabase(database: Database) {
  try {
    const rows = mapRows<{
      id: string;
      title: string;
      content: string;
      source_type: KnowledgeDocumentSourceType | null;
      source_uri: string | null;
      tags_json: string | null;
      synced_at: string | null;
      updated_at: string | null;
    }>(
      database.exec(`
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
        ORDER BY COALESCE(m.updated_at, '') DESC, d.rowid DESC
      `),
    );

    return rows.map((row) => {
      return {
        id: row.id,
        title: row.title,
        content: row.content,
        sourceType: row.source_type ?? 'user_upload',
        sourceUri: row.source_uri ?? undefined,
        tags: parseKnowledgeTags(row.tags_json, `"${row.id}"`),
        syncedAt: row.synced_at ?? undefined,
        updatedAt: row.updated_at ?? undefined,
      };
    });
  } catch {
    return [];
  }
}

export function deleteDocumentInDatabase(database: Database, id: string) {
  clearDocumentChunks(database, id);
  clearDocumentGraph(database, id);
  deleteDocumentChunkEmbeddings(database, id);
  database.run('DELETE FROM document_metadata WHERE document_id = ?', [id]);
  database.run('DELETE FROM document_quality_score WHERE document_id = ?', [id]);
  database.run('DELETE FROM documents WHERE id = ?', [id]);
  clearDocumentSearchCache(database);
}
