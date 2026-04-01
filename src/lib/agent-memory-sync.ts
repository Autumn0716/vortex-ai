import type { Database } from './db';
import { buildAgentMemoryPaths, parseMemoryMarkdown, serializeMemoryMarkdown } from './agent-memory-files';
import { scoreMemoryImportance, type MemoryScope, type MemorySourceType } from './agent-memory-model';

export interface AgentMemoryFileStore {
  listPaths(prefix: string): Promise<string[]>;
  readText(path: string): Promise<string | null>;
  writeText(path: string, content: string): Promise<void>;
}

interface DerivedMemoryDocument {
  id: string;
  title: string;
  content: string;
  memoryScope: MemoryScope;
  sourceType: MemorySourceType;
  importanceScore: number;
  eventDate: string | null;
  updatedAt: string;
}

interface LegacyMemoryRow {
  id: string;
  title: string;
  content: string;
  memory_scope: MemoryScope;
  source_type: MemorySourceType;
  event_date: string | null;
  created_at: string;
  updated_at: string;
}

const DERIVED_MEMORY_ID_PREFIX = 'memory_file_';
const MIGRATABLE_GLOBAL_SOURCE_TYPES = new Set<MemorySourceType>(['manual', 'promotion']);
const MIGRATABLE_DAILY_SOURCE_TYPES = new Set<MemorySourceType>(['conversation_log']);

let registeredAgentMemoryFileStore: AgentMemoryFileStore | null = null;

export function setAgentMemoryFileStore(fileStore: AgentMemoryFileStore | null) {
  registeredAgentMemoryFileStore = fileStore;
}

export function getAgentMemoryFileStore() {
  return registeredAgentMemoryFileStore;
}

function isMigratableLegacyRow(row: LegacyMemoryRow) {
  if (row.memory_scope === 'global') {
    return MIGRATABLE_GLOBAL_SOURCE_TYPES.has(row.source_type);
  }
  if (row.memory_scope === 'daily') {
    return Boolean(row.event_date) && MIGRATABLE_DAILY_SOURCE_TYPES.has(row.source_type);
  }
  return false;
}

function mapRows<T extends Record<string, unknown>>(result: ReturnType<Database['exec']>): T[] {
  if (result.length === 0) {
    return [];
  }

  const entry = result[0]!;
  return entry.values.map((row) => {
    const mapped: Record<string, unknown> = {};
    entry.columns.forEach((column, index) => {
      mapped[column] = row[index];
    });
    return mapped as T;
  });
}

function hashString(input: string) {
  let hash = 5381;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 33) ^ input.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

function buildDerivedMemoryId(agentId: string, path: string) {
  return `${DERIVED_MEMORY_ID_PREFIX}${hashString(`${agentId}:${path}`)}`;
}

function normalizeBody(markdown: string) {
  return parseMemoryMarkdown(markdown).body.trim();
}

function buildGlobalMemoryTitle(markdown: string) {
  const { frontmatter } = parseMemoryMarkdown(markdown);
  return typeof frontmatter.title === 'string' && frontmatter.title.trim()
    ? frontmatter.title.trim()
    : 'Agent Memory';
}

function buildDailyMemoryTitle(markdown: string, eventDate: string) {
  const { frontmatter } = parseMemoryMarkdown(markdown);
  return typeof frontmatter.title === 'string' && frontmatter.title.trim()
    ? frontmatter.title.trim()
    : `${eventDate} Daily Memory`;
}

function buildDailyEventDate(path: string) {
  const match = path.match(/(\d{4}-\d{2}-\d{2})\.md$/);
  return match?.[1] ?? null;
}

function composeMigratedMarkdown(rows: LegacyMemoryRow[], fallbackTitle: string) {
  const normalizedRows = rows
    .filter((row) => row.content.trim())
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at) || right.created_at.localeCompare(left.created_at));

  if (normalizedRows.length === 0) {
    return '';
  }

  const title = normalizedRows.length === 1 ? normalizedRows[0]!.title.trim() || fallbackTitle : fallbackTitle;
  const body = normalizedRows
    .map((row) => {
      const content = row.content.trim();
      if (!content) {
        return '';
      }

      if (normalizedRows.length === 1) {
        return content;
      }

      return `## ${row.title.trim() || fallbackTitle}\n\n${content}`;
    })
    .filter(Boolean)
    .join('\n\n');

  return serializeMemoryMarkdown({
    frontmatter: { title },
    body,
  });
}

async function migrateLegacyAgentMemoryToStore(
  database: Database,
  input: {
    agentId: string;
    agentSlug: string;
    fileStore: AgentMemoryFileStore;
  },
) {
  const today = new Date().toISOString().slice(0, 10);
  const paths = buildAgentMemoryPaths(input.agentSlug, today);
  const existingMemoryFile = await input.fileStore.readText(paths.memoryFile);
  const existingDailyPaths = new Set((await input.fileStore.listPaths(paths.dailyDir)).filter((path) => path.endsWith('.md')));

  const rows = mapRows<LegacyMemoryRow>(
    database.exec(
      `
        SELECT
          id,
          title,
          content,
          memory_scope,
          source_type,
          event_date,
          created_at,
          updated_at
        FROM agent_memory_documents
        WHERE agent_id = ?
          AND id NOT LIKE ?
        ORDER BY updated_at DESC, created_at DESC
      `,
      [input.agentId, `${DERIVED_MEMORY_ID_PREFIX}%`],
    ),
  ).filter(isMigratableLegacyRow);

  let changed = false;
  if (existingMemoryFile === null) {
    const globalRows = rows.filter((row) => row.memory_scope === 'global');
    const migratedMarkdown = composeMigratedMarkdown(globalRows, 'Agent Memory');
    if (migratedMarkdown) {
      await input.fileStore.writeText(paths.memoryFile, migratedMarkdown);
      changed = true;
    }
  }

  const dailyRowsByDate = new Map<string, LegacyMemoryRow[]>();
  rows
    .filter((row) => row.memory_scope === 'daily' && row.event_date)
    .forEach((row) => {
      const eventDate = row.event_date!;
      const list = dailyRowsByDate.get(eventDate) ?? [];
      list.push(row);
      dailyRowsByDate.set(eventDate, list);
    });

  for (const [eventDate, eventRows] of dailyRowsByDate) {
    const dailyPath = buildAgentMemoryPaths(input.agentSlug, eventDate).dailyFile;
    if (existingDailyPaths.has(dailyPath)) {
      continue;
    }

    const migratedMarkdown = composeMigratedMarkdown(eventRows, `${eventDate} Daily Memory`);
    if (!migratedMarkdown) {
      continue;
    }

    await input.fileStore.writeText(dailyPath, migratedMarkdown);
    changed = true;
  }

  return { changed, rows };
}

function buildDerivedDocuments(input: {
  agentId: string;
  agentSlug: string;
  memoryMarkdown: string | null;
  dailyFiles: Array<{ path: string; markdown: string }>;
  now: string;
}) {
  const documents: DerivedMemoryDocument[] = [];
  const today = input.now.slice(0, 10);
  const paths = buildAgentMemoryPaths(input.agentSlug, today);

  if (input.memoryMarkdown !== null) {
    const content = normalizeBody(input.memoryMarkdown);
    if (content) {
      documents.push({
        id: buildDerivedMemoryId(input.agentId, paths.memoryFile),
        title: buildGlobalMemoryTitle(input.memoryMarkdown),
        content,
        memoryScope: 'global',
        sourceType: 'manual',
        importanceScore: scoreMemoryImportance(content, 'manual'),
        eventDate: null,
        updatedAt: input.now,
      });
    }
  }

  input.dailyFiles
    .slice()
    .sort((left, right) => left.path.localeCompare(right.path))
    .forEach((file) => {
      const eventDate = buildDailyEventDate(file.path);
      const content = normalizeBody(file.markdown);
      if (!eventDate || !content) {
        return;
      }

      documents.push({
        id: buildDerivedMemoryId(input.agentId, file.path),
        title: buildDailyMemoryTitle(file.markdown, eventDate),
        content,
        memoryScope: 'daily',
        sourceType: 'conversation_log',
        importanceScore: scoreMemoryImportance(content, 'conversation_log'),
        eventDate,
        updatedAt: input.now,
      });
    });

  return documents;
}

function upsertDerivedDocuments(database: Database, agentId: string, documents: DerivedMemoryDocument[]) {
  const existingRows = mapRows<{
    id: string;
    title: string;
    content: string;
    memory_scope: MemoryScope;
    source_type: MemorySourceType;
    importance_score: number;
    event_date: string | null;
    created_at: string;
    updated_at: string;
  }>(
    database.exec(
      `
        SELECT
          id,
          title,
          content,
          memory_scope,
          source_type,
          importance_score,
          event_date,
          created_at,
          updated_at
        FROM agent_memory_documents
        WHERE agent_id = ?
          AND id LIKE ?
      `,
      [agentId, `${DERIVED_MEMORY_ID_PREFIX}%`],
    ),
  );
  const existingById = new Map(existingRows.map((row) => [row.id, row]));
  let changed = false;

  documents.forEach((document) => {
    const existing = existingById.get(document.id);
    if (
      existing &&
      existing.title === document.title &&
      existing.content === document.content &&
      existing.memory_scope === document.memoryScope &&
      existing.source_type === document.sourceType &&
      Number(existing.importance_score) === document.importanceScore &&
      existing.event_date === document.eventDate
    ) {
      return;
    }

    changed = true;
    if (existing) {
      database.run(
        `
          UPDATE agent_memory_documents
          SET
            title = ?,
            content = ?,
            memory_scope = ?,
            source_type = ?,
            importance_score = ?,
            topic_id = ?,
            event_date = ?,
            updated_at = ?
          WHERE id = ?
        `,
        [
          document.title,
          document.content,
          document.memoryScope,
          document.sourceType,
          document.importanceScore,
          null,
          document.eventDate,
          document.updatedAt,
          document.id,
        ],
      );
      return;
    }

    database.run(
      `
        INSERT INTO agent_memory_documents (
          id,
          agent_id,
          title,
          content,
          memory_scope,
          source_type,
          importance_score,
          topic_id,
          event_date,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        document.id,
        agentId,
        document.title,
        document.content,
        document.memoryScope,
        document.sourceType,
        document.importanceScore,
        null,
        document.eventDate,
        document.updatedAt,
        document.updatedAt,
      ],
    );
  });

  return changed;
}

function deleteStaleDerivedDocuments(database: Database, agentId: string, syncedIds: string[]) {
  const existingIds = mapRows<{ id: string }>(
    database.exec(
      `
        SELECT id
        FROM agent_memory_documents
        WHERE agent_id = ?
          AND id LIKE ?
      `,
      [agentId, `${DERIVED_MEMORY_ID_PREFIX}%`],
    ),
  ).map((row) => row.id);

  const staleIds = existingIds
    .filter((id) => !syncedIds.includes(id))
  staleIds.forEach((id) => {
    database.run('DELETE FROM agent_memory_documents WHERE id = ?', [id]);
  });

  return staleIds.length > 0;
}

function deleteMigratedLegacyRows(database: Database, rows: LegacyMemoryRow[]) {
  const deletableIds = rows.map((row) => row.id);
  deletableIds.forEach((id) => {
    database.run('DELETE FROM agent_memory_documents WHERE id = ?', [id]);
  });
  return deletableIds.length > 0;
}

export async function syncAgentMemoryFromStore(
  database: Database,
  input: {
    agentId: string;
    agentSlug: string;
    fileStore: AgentMemoryFileStore;
    now?: string;
  },
) {
  const now = input.now ?? new Date().toISOString();
  const migration = await migrateLegacyAgentMemoryToStore(database, input);
  const today = now.slice(0, 10);
  const paths = buildAgentMemoryPaths(input.agentSlug, today);
  const memoryMarkdown = await input.fileStore.readText(paths.memoryFile);
  const dailyPaths = (await input.fileStore.listPaths(paths.dailyDir))
    .filter((path) => path.endsWith('.md'))
    .sort();
  const dailyFiles = await Promise.all(
    dailyPaths.map(async (path) => ({
      path,
      markdown: (await input.fileStore.readText(path)) ?? '',
    })),
  );

  const documents = buildDerivedDocuments({
    agentId: input.agentId,
    agentSlug: input.agentSlug,
    memoryMarkdown,
    dailyFiles,
    now,
  });
  const upserted = upsertDerivedDocuments(database, input.agentId, documents);
  const deleted = deleteStaleDerivedDocuments(
    database,
    input.agentId,
    documents.map((document) => document.id),
  );
  const deletedLegacy = deleteMigratedLegacyRows(database, migration.rows);

  return {
    changed: migration.changed || upserted || deleted || deletedLegacy,
    migrated: migration.changed,
    syncedCount: documents.length,
  };
}
