import { getAgentConfig } from './agent/config';
import type { Database } from './db';
import { buildEmbeddingConfigFromDocuments } from './db';
import {
  buildAgentMemoryPaths,
  detectMemoryFileKind,
  parseMemoryMarkdown,
  resolveDailyMemoryDate,
  serializeMemoryMarkdown,
} from './agent-memory-files';
import {
  buildRuleBasedMemoryAssessment,
  buildColdMemorySurrogate,
  buildWarmMemorySurrogate,
  type MemoryImportanceAssessment,
  resolveLifecycleTier,
} from './agent-memory-lifecycle';
import {
  scoreMemoryImportance,
  selectEffectiveMemoryDocuments,
  type MemoryScope,
  type MemorySourceType,
} from './agent-memory-model';
import {
  buildEmbeddingContentHash,
  createEmbeddings,
  type EmbeddingProviderConfig,
} from './embedding-client';

export interface AgentMemoryFileStore {
  listPaths(prefix: string): Promise<string[]>;
  readText(path: string): Promise<string | null>;
  writeText(path: string, content: string): Promise<void>;
  deleteText?(path: string): Promise<void>;
}

export interface AgentMemoryLifecycleResult {
  scannedCount: number;
  warmUpdated: number;
  coldUpdated: number;
  skippedCount: number;
  failures: Array<{ path: string; message: string }>;
  scoring?: {
    llmScoredCount: number;
    ruleFallbackCount: number;
  };
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

interface AgentMemoryEmbeddingRow {
  memory_document_id: string;
  content_hash: string;
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

function mapRows<T>(result: ReturnType<Database['exec']>): T[] {
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

function buildDailyMemoryTitle(markdown: string, fallbackTitle: string) {
  const { frontmatter } = parseMemoryMarkdown(markdown);
  return typeof frontmatter.title === 'string' && frontmatter.title.trim()
    ? frontmatter.title.trim()
    : fallbackTitle;
}

function buildBootstrapMemoryTitle(markdown: string, fallbackTitle: string) {
  const { frontmatter } = parseMemoryMarkdown(markdown);
  return typeof frontmatter.title === 'string' && frontmatter.title.trim()
    ? frontmatter.title.trim()
    : fallbackTitle;
}

function resolveFrontmatterImportance(markdown: string, fallbackContent: string, sourceType: MemorySourceType) {
  const { frontmatter } = parseMemoryMarkdown(markdown);
  const value = frontmatter.importance;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(1, Math.min(5, Math.round(value)));
  }
  return scoreMemoryImportance(fallbackContent, sourceType);
}

function resolveDailyMemoryMetadata(path: string, eventDate: string) {
  const kind = detectMemoryFileKind(path);

  if (kind === 'daily_warm') {
    return {
      sourceType: 'warm_summary' as const,
      fallbackTitle: `${eventDate} Warm Memory`,
    };
  }
  if (kind === 'daily_cold') {
    return {
      sourceType: 'cold_summary' as const,
      fallbackTitle: `${eventDate} Cold Memory`,
    };
  }
  if (kind === 'daily_source') {
    return {
      sourceType: 'conversation_log' as const,
      fallbackTitle: `${eventDate} Daily Memory`,
    };
  }

  return null;
}

function buildDerivedDailyUpdatedAt(eventDate: string) {
  return `${eventDate}T23:59:59.999Z`;
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
  correctionsMarkdown: string | null;
  reflectionsMarkdown: string | null;
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

  if (input.correctionsMarkdown !== null) {
    const content = normalizeBody(input.correctionsMarkdown);
    if (content) {
      documents.push({
        id: buildDerivedMemoryId(input.agentId, paths.correctionsFile),
        title: buildBootstrapMemoryTitle(input.correctionsMarkdown, 'Agent Corrections'),
        content,
        memoryScope: 'global',
        sourceType: 'correction',
        importanceScore: 5,
        eventDate: null,
        updatedAt: input.now,
      });
    }
  }

  if (input.reflectionsMarkdown !== null) {
    const content = normalizeBody(input.reflectionsMarkdown);
    if (content) {
      documents.push({
        id: buildDerivedMemoryId(input.agentId, paths.reflectionsFile),
        title: buildBootstrapMemoryTitle(input.reflectionsMarkdown, 'Agent Reflections'),
        content,
        memoryScope: 'global',
        sourceType: 'reflection',
        importanceScore: 4,
        eventDate: null,
        updatedAt: input.now,
      });
    }
  }

  input.dailyFiles
    .slice()
    .sort((left, right) => left.path.localeCompare(right.path))
    .forEach((file) => {
      const eventDate = resolveDailyMemoryDate(file.path);
      const metadata = eventDate ? resolveDailyMemoryMetadata(file.path, eventDate) : null;
      const content = normalizeBody(file.markdown);
      if (!eventDate || !metadata || !content) {
        return;
      }

      documents.push({
        id: buildDerivedMemoryId(input.agentId, file.path),
        title: buildDailyMemoryTitle(file.markdown, metadata.fallbackTitle),
        content,
        memoryScope: 'daily',
        sourceType: metadata.sourceType,
        importanceScore: resolveFrontmatterImportance(file.markdown, content, metadata.sourceType),
        eventDate,
        updatedAt: buildDerivedDailyUpdatedAt(eventDate),
      });
    });

  return selectEffectiveMemoryDocuments(documents, {
    now: input.now,
    requireSourceDocument: true,
  });
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
      existing.event_date === document.eventDate &&
      (document.memoryScope !== 'daily' || existing.updated_at === document.updatedAt)
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

function readColdMemoryEmbeddingRows(database: Database, agentId: string) {
  return mapRows<AgentMemoryEmbeddingRow>(
    database.exec(
      `
        SELECT memory_document_id, content_hash
        FROM agent_memory_embeddings
        WHERE agent_id = ?
          AND source_type = 'cold_summary'
      `,
      [agentId],
    ),
  );
}

function deleteColdMemoryEmbedding(database: Database, memoryDocumentId: string) {
  database.run('DELETE FROM agent_memory_embeddings WHERE memory_document_id = ?', [memoryDocumentId]);
}

function upsertColdMemoryEmbedding(
  database: Database,
  input: {
    memoryDocumentId: string;
    agentId: string;
    eventDate: string | null;
    sourceType: MemorySourceType;
    embeddingModel: string;
    embeddingDimensions: number;
    contentHash: string;
    embeddingJson: string;
    contentPreview: string;
    updatedAt: string;
  },
) {
  database.run(
    `
      INSERT INTO agent_memory_embeddings (
        memory_document_id,
        agent_id,
        event_date,
        source_type,
        embedding_model,
        embedding_dimensions,
        content_hash,
        embedding_json,
        content_preview,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(memory_document_id) DO UPDATE SET
        agent_id = excluded.agent_id,
        event_date = excluded.event_date,
        source_type = excluded.source_type,
        embedding_model = excluded.embedding_model,
        embedding_dimensions = excluded.embedding_dimensions,
        content_hash = excluded.content_hash,
        embedding_json = excluded.embedding_json,
        content_preview = excluded.content_preview,
        updated_at = excluded.updated_at
    `,
    [
      input.memoryDocumentId,
      input.agentId,
      input.eventDate,
      input.sourceType,
      input.embeddingModel,
      input.embeddingDimensions,
      input.contentHash,
      input.embeddingJson,
      input.contentPreview,
      input.updatedAt,
    ],
  );
}

async function resolveEmbeddingConfig(override?: EmbeddingProviderConfig | null) {
  if (override !== undefined) {
    return override;
  }

  const config = await getAgentConfig();
  return buildEmbeddingConfigFromDocuments(config.documents);
}

async function syncColdMemoryEmbeddings(
  database: Database,
  input: {
    agentId: string;
    documents: DerivedMemoryDocument[];
    embeddingConfig?: EmbeddingProviderConfig | null;
  },
) {
  const coldDocuments = input.documents.filter((document) => document.sourceType === 'cold_summary');
  const currentIds = new Set(coldDocuments.map((document) => document.id));
  const existingRows = readColdMemoryEmbeddingRows(database, input.agentId);

  existingRows.forEach((row) => {
    if (!currentIds.has(row.memory_document_id)) {
      deleteColdMemoryEmbedding(database, row.memory_document_id);
    }
  });

  const embeddingConfig = await resolveEmbeddingConfig(input.embeddingConfig);
  const existingById = new Map(existingRows.map((row) => [row.memory_document_id, row]));

  if (!embeddingConfig) {
    coldDocuments.forEach((document) => {
      const contentHash = buildEmbeddingContentHash(document.content);
      const existing = existingById.get(document.id);
      if (existing && existing.content_hash !== contentHash) {
        deleteColdMemoryEmbedding(database, document.id);
      }
    });
    return;
  }

  for (const document of coldDocuments) {
    const contentHash = buildEmbeddingContentHash(document.content);
    const existing = existingById.get(document.id);
    if (existing?.content_hash === contentHash) {
      continue;
    }

    const response = await createEmbeddings(document.content, embeddingConfig);
    const embedding = response.data[0]?.embedding;
    if (!Array.isArray(embedding) || embedding.length === 0) {
      continue;
    }

    upsertColdMemoryEmbedding(database, {
      memoryDocumentId: document.id,
      agentId: input.agentId,
      eventDate: document.eventDate,
      sourceType: document.sourceType,
      embeddingModel: embeddingConfig.model,
      embeddingDimensions: embedding.length,
      contentHash,
      embeddingJson: JSON.stringify(embedding),
      contentPreview: document.content.slice(0, 240),
      updatedAt: document.updatedAt,
    });
  }
}

function deleteMigratedLegacyRows(database: Database, rows: LegacyMemoryRow[]) {
  const deletableIds = rows.map((row) => row.id);
  deletableIds.forEach((id) => {
    database.run('DELETE FROM agent_memory_documents WHERE id = ?', [id]);
  });
  return deletableIds.length > 0;
}

async function writeIfChanged(fileStore: AgentMemoryFileStore, path: string, content: string) {
  const existing = await fileStore.readText(path);
  if (existing !== null && normalizeLifecycleMarkdown(existing) === normalizeLifecycleMarkdown(content)) {
    return false;
  }

  await fileStore.writeText(path, content);
  return true;
}

async function deleteIfExists(fileStore: AgentMemoryFileStore, path: string) {
  if ((await fileStore.readText(path)) === null) {
    return false;
  }

  if (typeof fileStore.deleteText !== 'function') {
    throw new Error(`The active memory file store cannot delete ${path}.`);
  }

  await fileStore.deleteText(path);
  return true;
}

function pushLifecycleFailure(
  failures: AgentMemoryLifecycleResult['failures'],
  path: string,
  error: unknown,
  fallbackMessage: string,
) {
  failures.push({
    path,
    message: error instanceof Error ? error.message : fallbackMessage,
  });
}

async function deleteWithFailureCapture(
  fileStore: AgentMemoryFileStore,
  path: string,
  failures: AgentMemoryLifecycleResult['failures'],
) {
  try {
    await deleteIfExists(fileStore, path);
  } catch (error) {
    pushLifecycleFailure(failures, path, error, 'Lifecycle cleanup failed.');
  }
}

function normalizeLifecycleMarkdown(markdown: string) {
  const { frontmatter, body } = parseMemoryMarkdown(markdown);
  const normalizedFrontmatter = { ...frontmatter };
  delete normalizedFrontmatter.updatedAt;

  return serializeMemoryMarkdown({
    frontmatter: normalizedFrontmatter,
    body,
  });
}

export async function syncAgentMemoryFromStore(
  database: Database,
  input: {
    agentId: string;
    agentSlug: string;
    fileStore: AgentMemoryFileStore;
    now?: string;
    embeddingConfig?: EmbeddingProviderConfig | null;
  },
) {
  const now = input.now ?? new Date().toISOString();
  const migration = await migrateLegacyAgentMemoryToStore(database, input);
  const today = now.slice(0, 10);
  const paths = buildAgentMemoryPaths(input.agentSlug, today);
  const memoryMarkdown = await input.fileStore.readText(paths.memoryFile);
  const correctionsMarkdown = await input.fileStore.readText(paths.correctionsFile);
  const reflectionsMarkdown = await input.fileStore.readText(paths.reflectionsFile);
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
    correctionsMarkdown,
    reflectionsMarkdown,
    dailyFiles,
    now,
  });
  const upserted = upsertDerivedDocuments(database, input.agentId, documents);
  const deleted = deleteStaleDerivedDocuments(
    database,
    input.agentId,
    documents.map((document) => document.id),
  );
  await syncColdMemoryEmbeddings(database, {
    agentId: input.agentId,
    documents,
    embeddingConfig: input.embeddingConfig,
  });
  const deletedLegacy = deleteMigratedLegacyRows(database, migration.rows);

  return {
    changed: migration.changed || upserted || deleted || deletedLegacy,
    migrated: migration.changed,
    syncedCount: documents.length,
  };
}

export async function syncAgentMemoryLifecycleFromStore(input: {
  agentSlug: string;
  fileStore: AgentMemoryFileStore;
  now?: string;
  scoreImportance?: (input: {
    date: string;
    tier: 'warm' | 'cold';
    sourcePath: string;
    sourceMarkdown: string;
  }) => Promise<MemoryImportanceAssessment>;
}): Promise<AgentMemoryLifecycleResult> {
  const now = input.now ?? new Date().toISOString();
  const dailyDir = buildAgentMemoryPaths(input.agentSlug, now.slice(0, 10)).dailyDir;
  const paths = (await input.fileStore.listPaths(dailyDir)).sort();
  const sourcePaths = paths.filter((path) => detectMemoryFileKind(path) === 'daily_source');
  const availableSourceDates = new Set(
    sourcePaths.map((path) => resolveDailyMemoryDate(path)).filter((date): date is string => Boolean(date)),
  );

  let warmUpdated = 0;
  let coldUpdated = 0;
  let skippedCount = 0;
  let llmScoredCount = 0;
  let ruleFallbackCount = 0;
  const failures: Array<{ path: string; message: string }> = [];

  for (const path of sourcePaths) {
    try {
      const date = resolveDailyMemoryDate(path);
      const sourceMarkdown = (await input.fileStore.readText(path)) ?? '';
      if (!date) {
        skippedCount += 1;
        continue;
      }

      if (!sourceMarkdown.trim()) {
        const dailyPaths = buildAgentMemoryPaths(input.agentSlug, date);
        await deleteWithFailureCapture(input.fileStore, dailyPaths.warmFile, failures);
        await deleteWithFailureCapture(input.fileStore, dailyPaths.coldFile, failures);
        skippedCount += 1;
        continue;
      }

      const tier = resolveLifecycleTier(date, now);
      const dailyPaths = buildAgentMemoryPaths(input.agentSlug, date);

      if (tier === 'warm') {
        let assessment = buildRuleBasedMemoryAssessment({
          tier: 'warm',
          sourceMarkdown,
        });
        if (input.scoreImportance) {
          try {
            assessment = await input.scoreImportance({
              date,
              tier: 'warm',
              sourcePath: path,
              sourceMarkdown,
            });
            llmScoredCount += assessment.source === 'llm' ? 1 : 0;
            ruleFallbackCount += assessment.source === 'rules' ? 1 : 0;
          } catch {
            ruleFallbackCount += 1;
          }
        }
        const nextWarm = buildWarmMemorySurrogate({
          date,
          sourcePath: path,
          sourceMarkdown,
          now,
          assessment,
        });
        if (await writeIfChanged(input.fileStore, dailyPaths.warmFile, nextWarm)) {
          warmUpdated += 1;
        } else {
          skippedCount += 1;
        }
        await deleteWithFailureCapture(input.fileStore, dailyPaths.coldFile, failures);
        continue;
      }

      if (tier === 'cold') {
        let assessment = buildRuleBasedMemoryAssessment({
          tier: 'cold',
          sourceMarkdown,
        });
        if (input.scoreImportance) {
          try {
            assessment = await input.scoreImportance({
              date,
              tier: 'cold',
              sourcePath: path,
              sourceMarkdown,
            });
            llmScoredCount += assessment.source === 'llm' ? 1 : 0;
            ruleFallbackCount += assessment.source === 'rules' ? 1 : 0;
          } catch {
            ruleFallbackCount += 1;
          }
        }
        const nextCold = buildColdMemorySurrogate({
          date,
          sourcePath: path,
          sourceMarkdown,
          now,
          assessment,
        });
        if (await writeIfChanged(input.fileStore, dailyPaths.coldFile, nextCold)) {
          coldUpdated += 1;
        } else {
          skippedCount += 1;
        }
        await deleteWithFailureCapture(input.fileStore, dailyPaths.warmFile, failures);
        continue;
      }

      await deleteWithFailureCapture(input.fileStore, dailyPaths.warmFile, failures);
      await deleteWithFailureCapture(input.fileStore, dailyPaths.coldFile, failures);
      skippedCount += 1;
    } catch (error) {
      pushLifecycleFailure(failures, path, error, 'Lifecycle sync failed.');
    }
  }

  for (const path of paths) {
    const kind = detectMemoryFileKind(path);
    if (kind !== 'daily_warm' && kind !== 'daily_cold') {
      continue;
    }

    const date = resolveDailyMemoryDate(path);
    if (!date || availableSourceDates.has(date)) {
      continue;
    }

    await deleteWithFailureCapture(input.fileStore, path, failures);
  }

  const result: AgentMemoryLifecycleResult = {
    scannedCount: sourcePaths.length,
    warmUpdated,
    coldUpdated,
    skippedCount,
    failures,
  };
  if (input.scoreImportance) {
    result.scoring = {
      llmScoredCount,
      ruleFallbackCount,
    };
  }
  return result;
}
