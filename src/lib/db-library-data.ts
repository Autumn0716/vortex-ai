import { getAssistantRow } from './db-bootstrap';
import { Database } from './db-core';
import { getScalar, mapRows } from './db-row-helpers';
import { toAssistantProfile, toPromptSnippet } from './db-row-mappers';
import { runDatabaseTransaction } from './db-transaction';
import type { AssistantProfile, PromptSnippet } from './db-types';

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `${prefix}_${uuid ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
}

export function listAssistantsInDatabase(database: Database): AssistantProfile[] {
  const rows = mapRows<{
    id: string;
    name: string;
    description: string;
    system_prompt: string;
    provider_id: string | null;
    model: string | null;
    accent_color: string;
    is_default: number;
    created_at: string;
    updated_at: string;
  }>(
    database.exec(`
      SELECT
        id,
        name,
        description,
        system_prompt,
        provider_id,
        model,
        accent_color,
        is_default,
        created_at,
        updated_at
      FROM assistants
      ORDER BY is_default DESC, created_at ASC
    `),
  );

  return rows.map(toAssistantProfile);
}

export async function saveAssistantInDatabase(
  database: Database,
  draft: Omit<AssistantProfile, 'createdAt' | 'updatedAt' | 'isDefault'> & { isDefault?: boolean },
): Promise<AssistantProfile> {
  const timestamp = nowIso();
  const isNew = !draft.id;
  const id = draft.id || createId('assistant');
  const isDefault = draft.isDefault ? 1 : 0;

  await runDatabaseTransaction(database, () => {
    if (isDefault) {
      database.run('UPDATE assistants SET is_default = 0');
    }

    if (isNew) {
      database.run(
        `
          INSERT INTO assistants (
            id,
            name,
            description,
            system_prompt,
            provider_id,
            model,
            accent_color,
            is_default,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          id,
          draft.name.trim(),
          draft.description.trim(),
          draft.systemPrompt.trim(),
          draft.providerId ?? null,
          draft.model ?? null,
          draft.accentColor,
          isDefault,
          timestamp,
          timestamp,
        ],
      );
    } else {
      database.run(
        `
          UPDATE assistants
          SET
            name = ?,
            description = ?,
            system_prompt = ?,
            provider_id = ?,
            model = ?,
            accent_color = ?,
            is_default = ?,
            updated_at = ?
          WHERE id = ?
        `,
        [
          draft.name.trim(),
          draft.description.trim(),
          draft.systemPrompt.trim(),
          draft.providerId ?? null,
          draft.model ?? null,
          draft.accentColor,
          isDefault,
          timestamp,
          id,
        ],
      );
    }
  });

  const assistant = getAssistantRow(database, id);
  if (!assistant) {
    throw new Error('Failed to save assistant.');
  }

  return assistant;
}

export function listPromptSnippetsInDatabase(database: Database): PromptSnippet[] {
  const rows = mapRows<{
    id: string;
    title: string;
    content: string;
    category: string;
    created_at: string;
    updated_at: string;
  }>(
    database.exec(`
      SELECT
        id,
        title,
        content,
        category,
        created_at,
        updated_at
      FROM prompt_snippets
      ORDER BY created_at ASC
    `),
  );

  return rows.map(toPromptSnippet);
}

export function savePromptSnippetInDatabase(
  database: Database,
  draft: Omit<PromptSnippet, 'createdAt' | 'updatedAt'>,
): PromptSnippet {
  const timestamp = nowIso();
  const id = draft.id || createId('snippet');
  const exists = Number(
    getScalar(database, 'SELECT COUNT(*) FROM prompt_snippets WHERE id = ?', [id]) ?? 0,
  );

  if (exists > 0) {
    database.run(
      `
        UPDATE prompt_snippets
        SET title = ?, content = ?, category = ?, updated_at = ?
        WHERE id = ?
      `,
      [draft.title.trim(), draft.content.trim(), draft.category.trim(), timestamp, id],
    );
  } else {
    database.run(
      `
        INSERT INTO prompt_snippets (
          id,
          title,
          content,
          category,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      [id, draft.title.trim(), draft.content.trim(), draft.category.trim(), timestamp, timestamp],
    );
  }

  const row = mapRows<{
    id: string;
    title: string;
    content: string;
    category: string;
    created_at: string;
    updated_at: string;
  }>(
    database.exec(
      `
        SELECT
          id,
          title,
          content,
          category,
          created_at,
          updated_at
        FROM prompt_snippets
        WHERE id = ?
        LIMIT 1
      `,
      [id],
    ),
  )[0];

  if (!row) {
    throw new Error('Failed to save prompt snippet.');
  }

  return toPromptSnippet(row);
}
