import type { Database } from './db-core';
import { mapRows } from './db-row-helpers';
import {
  buildEmbeddingContentHash,
  createEmbeddings,
  DEFAULT_EMBEDDING_BASE_URL,
  DEFAULT_EMBEDDING_DIMENSIONS,
  DEFAULT_EMBEDDING_MODEL,
  type EmbeddingProviderConfig,
} from './embedding-client';

function nowIso(): string {
  return new Date().toISOString();
}

export function parseEmbeddingJson(raw: string) {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((value) => Number(value) || 0);
    }
    console.warn('Failed to parse embedding JSON; expected an array payload.');
    return [];
  } catch (error) {
    console.warn('Failed to parse embedding JSON; falling back to an empty vector:', error);
    return [];
  }
}

export function buildEmbeddingConfigFromDocuments(documents: {
  enableVectorSearch: boolean;
  embeddingApiKey: string;
  embeddingModel: string;
  embeddingBaseUrl: string;
  embeddingDimensions: number;
}): EmbeddingProviderConfig | null {
  if (!documents.enableVectorSearch || !documents.embeddingApiKey.trim()) {
    return null;
  }

  return {
    apiKey: documents.embeddingApiKey.trim(),
    model: documents.embeddingModel.trim() || DEFAULT_EMBEDDING_MODEL,
    baseUrl: documents.embeddingBaseUrl.trim() || DEFAULT_EMBEDDING_BASE_URL,
    dimensions: documents.embeddingDimensions || DEFAULT_EMBEDDING_DIMENSIONS,
    encodingFormat: 'float',
  };
}

export function deleteDocumentChunkEmbeddings(database: Database, documentId: string) {
  database.run('DELETE FROM document_chunk_embeddings WHERE document_id = ?', [documentId]);
}

export async function syncDocumentChunkEmbeddings(
  database: Database,
  documentId: string,
  embeddingConfig: EmbeddingProviderConfig,
) {
  const rows = mapRows<{
    id: string;
    document_id: string;
    content: string;
  }>(
    database.exec(
      `
        SELECT id, document_id, content
        FROM document_chunks
        WHERE document_id = ?
        ORDER BY chunk_index ASC
      `,
      [documentId],
    ),
  );

  if (rows.length === 0) {
    deleteDocumentChunkEmbeddings(database, documentId);
    return;
  }

  const existingRows = mapRows<{
    chunk_id: string;
    content_hash: string;
  }>(
    database.exec(
      `
        SELECT chunk_id, content_hash
        FROM document_chunk_embeddings
        WHERE document_id = ?
      `,
      [documentId],
    ),
  );
  const existingHashes = new Map(existingRows.map((row) => [row.chunk_id, row.content_hash]));
  const staleChunkIds = existingRows
    .map((row) => row.chunk_id)
    .filter((chunkId) => !rows.some((row) => row.id === chunkId));
  staleChunkIds.forEach((chunkId) => {
    database.run('DELETE FROM document_chunk_embeddings WHERE chunk_id = ?', [chunkId]);
  });

  const missingRows = rows.filter((row) => existingHashes.get(row.id) !== buildEmbeddingContentHash(row.content));
  if (missingRows.length === 0) {
    return;
  }

  const batchSize = 10;
  for (let offset = 0; offset < missingRows.length; offset += batchSize) {
    const batch = missingRows.slice(offset, offset + batchSize);
    const response = await createEmbeddings(
      batch.map((row) => row.content),
      embeddingConfig,
    );

    batch.forEach((row, index) => {
      const embedding = response.data[index]?.embedding;
      if (!Array.isArray(embedding) || embedding.length === 0) {
        return;
      }

      database.run(
        `
          INSERT INTO document_chunk_embeddings (
            chunk_id,
            document_id,
            model,
            dimensions,
            content_hash,
            embedding_json,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(chunk_id) DO UPDATE SET
            document_id = excluded.document_id,
            model = excluded.model,
            dimensions = excluded.dimensions,
            content_hash = excluded.content_hash,
            embedding_json = excluded.embedding_json,
            updated_at = excluded.updated_at
        `,
        [
          row.id,
          row.document_id,
          embeddingConfig.model,
          embedding.length,
          buildEmbeddingContentHash(row.content),
          JSON.stringify(embedding),
          nowIso(),
        ],
      );
    });
  }
}

export async function ensureDocumentEmbeddings(database: Database, embeddingConfig: EmbeddingProviderConfig) {
  const documentIds = mapRows<{ id: string }>(
    database.exec('SELECT id FROM documents ORDER BY rowid ASC'),
  ).map((row) => row.id);

  for (const documentId of documentIds) {
    await syncDocumentChunkEmbeddings(database, documentId, embeddingConfig);
  }
}
