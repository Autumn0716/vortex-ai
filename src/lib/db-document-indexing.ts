import type { Database } from './db-core';
import { hasFts5Table } from './db-fts5-helpers';
import { buildDocumentKnowledgeGraph, chunkDocumentContent } from './local-rag-helpers';
import { mapRows } from './db-row-helpers';
import { clearDocumentSearchCache } from './db-search-cache';

function nowIso(): string {
  return new Date().toISOString();
}

export function getDocumentFtsEnabled(database: Database): boolean {
  return hasFts5Table(database, 'document_chunks_fts');
}

export function clearDocumentChunks(database: Database, documentId: string) {
  database.run('DELETE FROM document_chunks WHERE document_id = ?', [documentId]);
  if (getDocumentFtsEnabled(database)) {
    database.run('DELETE FROM document_chunks_fts WHERE document_id = ?', [documentId]);
  }
}

export function clearDocumentGraph(database: Database, documentId: string) {
  database.run('DELETE FROM document_graph_nodes WHERE document_id = ?', [documentId]);
  database.run('DELETE FROM document_graph_edges WHERE document_id = ?', [documentId]);
}

export function indexDocumentChunks(
  database: Database,
  document: { id: string; title: string; content: string },
) {
  clearDocumentChunks(database, document.id);
  const timestamp = nowIso();
  const chunks = chunkDocumentContent(document.content);
  const normalizedChunks = chunks.length > 0 ? chunks : [{ index: 0, text: document.content.trim() }];

  normalizedChunks.forEach((chunk) => {
    const chunkId = `${document.id}::${chunk.index}`;
    database.run(
      `
        INSERT INTO document_chunks (
          id,
          document_id,
          chunk_index,
          title,
          content,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      [chunkId, document.id, chunk.index, document.title, chunk.text, timestamp],
    );

    if (getDocumentFtsEnabled(database)) {
      database.run(
        `
          INSERT INTO document_chunks_fts (
            chunk_id,
            document_id,
            title,
            content
          )
          VALUES (?, ?, ?, ?)
        `,
        [chunkId, document.id, document.title, chunk.text],
      );
    }
  });

  indexDocumentGraph(database, document);
}

function indexDocumentGraph(
  database: Database,
  document: { id: string; title: string; content: string },
) {
  clearDocumentGraph(database, document.id);
  const graph = buildDocumentKnowledgeGraph(document.title, document.content);

  graph.nodes.forEach((node) => {
    database.run(
      `
        INSERT INTO document_graph_nodes (
          document_id,
          normalized_entity,
          entity,
          entity_type,
          weight
        )
        VALUES (?, ?, ?, ?, ?)
      `,
      [document.id, node.normalizedEntity, node.entity, node.entityType, node.weight],
    );
  });

  graph.edges.forEach((edge) => {
    database.run(
      `
        INSERT INTO document_graph_edges (
          document_id,
          source_entity,
          target_entity,
          relation,
          weight
        )
        VALUES (?, ?, ?, ?, ?)
      `,
      [document.id, edge.sourceEntity, edge.targetEntity, edge.relation, edge.weight],
    );
  });
}

export async function ensureDocumentIndexes(database: Database) {
  const documentsNeedingIndex = mapRows<{ id: string; title: string; content: string }>(
    database.exec(
      `
        SELECT d.id, d.title, d.content
        FROM documents d
        LEFT JOIN document_chunks c ON c.document_id = d.id
        GROUP BY d.id, d.title, d.content
        HAVING COUNT(c.id) = 0
        ORDER BY d.rowid ASC
      `,
    ),
  );

  if (documentsNeedingIndex.length > 0) {
    clearDocumentSearchCache(database);
  }

  documentsNeedingIndex.forEach((document) => {
    indexDocumentChunks(database, document);
  });
}
