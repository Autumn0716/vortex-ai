import { Database } from './db-core';
import { getScalar, mapRows } from './db-row-helpers';
import { toGlobalMemoryDocument } from './db-row-mappers';
import type { GlobalMemoryDocument } from './db-types';

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `${prefix}_${uuid ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
}

export function listGlobalMemoryDocumentsInDatabase(database: Database): GlobalMemoryDocument[] {
  const rows = mapRows<{
    id: string;
    title: string;
    content: string;
    created_at: string;
    updated_at: string;
  }>(
    database.exec(`
      SELECT id, title, content, created_at, updated_at
      FROM global_memory_documents
      ORDER BY updated_at DESC, created_at DESC
    `),
  );

  return rows.map(toGlobalMemoryDocument);
}

export function saveGlobalMemoryDocumentInDatabase(
  database: Database,
  draft: {
    id?: string;
    title: string;
    content: string;
  },
): GlobalMemoryDocument {
  const timestamp = nowIso();
  const id = draft.id || createId('memory');
  const exists = Number(
    getScalar(database, 'SELECT COUNT(*) FROM global_memory_documents WHERE id = ?', [id]) ?? 0,
  );

  if (exists > 0) {
    database.run(
      `
        UPDATE global_memory_documents
        SET title = ?, content = ?, updated_at = ?
        WHERE id = ?
      `,
      [draft.title.trim() || 'Untitled Memory', draft.content, timestamp, id],
    );
  } else {
    database.run(
      `
        INSERT INTO global_memory_documents (
          id,
          title,
          content,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?)
      `,
      [id, draft.title.trim() || 'Untitled Memory', draft.content, timestamp, timestamp],
    );
  }

  const row = mapRows<{
    id: string;
    title: string;
    content: string;
    created_at: string;
    updated_at: string;
  }>(
    database.exec(
      `
        SELECT id, title, content, created_at, updated_at
        FROM global_memory_documents
        WHERE id = ?
        LIMIT 1
      `,
      [id],
    ),
  )[0];

  if (!row) {
    throw new Error('Failed to save global memory document.');
  }

  return toGlobalMemoryDocument(row);
}

export function deleteGlobalMemoryDocumentInDatabase(database: Database, id: string) {
  database.run('DELETE FROM global_memory_documents WHERE id = ?', [id]);
}
