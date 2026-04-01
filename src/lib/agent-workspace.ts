import localforage from 'localforage';
import type { Database, QueryExecResult, SqlValue, StoredToolRun } from './db';
import { initDB, saveDB } from './db';
import {
  buildAgentWorkspacePath,
  buildMigratedTopicTitle,
  DEFAULT_TOPIC_PREVIEW,
  DEFAULT_TOPIC_TITLE,
  formatTopicPreview,
  resolveActiveAgentId,
} from './agent-workspace-model';
import { ensureAgentWorkspaceSchema } from './agent-workspace-schema';
import {
  buildConversationMemoryEntry,
  buildMemoryPromotionTitle,
  buildPromotionFingerprint,
  formatLayeredMemoryContext,
  resolveMemoryTier,
  scoreMemoryImportance,
  selectEffectiveMemoryDocuments,
  shouldPromoteMemory,
  type MemoryScope,
  type MemorySourceType,
} from './agent-memory-model';
import { routeMemoryQuery, type MemoryRetrievalLayer } from './memory-lifecycle/query-router';
import { getAgentMemoryFileStore, syncAgentMemoryFromStore } from './agent-memory-sync';

const ACTIVE_AGENT_KEY = 'flowagent_active_agent_id_v2';
const ACTIVE_TOPIC_KEY = 'flowagent_active_topic_id_v2';

let ensuredPromise: Promise<void> | null = null;
let fts5Available: boolean | null = null;

const FALLBACK_AGENT_SEED = {
  id: 'agent_flowagent_core',
  name: 'FlowAgent Core',
  description: 'Balanced general-purpose agent for research, planning, and implementation.',
  systemPrompt:
    'You are FlowAgent Core. Be pragmatic, structured, and concise. Use tools when they materially improve the answer.',
  accentColor: 'from-blue-500/20 to-violet-500/20',
};

export interface AgentProfile {
  id: string;
  slug: string;
  name: string;
  description: string;
  systemPrompt: string;
  providerId?: string;
  model?: string;
  accentColor: string;
  workspaceRelpath: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TopicSummary {
  id: string;
  agentId: string;
  title: string;
  titleSource: 'auto' | 'manual';
  preview: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
  messageCount: number;
}

export interface TopicMessage {
  id: string;
  topicId: string;
  agentId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  authorName: string;
  content: string;
  createdAt: string;
  tools?: StoredToolRun[];
}

export interface TopicMessageInput {
  id?: string;
  topicId: string;
  agentId: string;
  role: TopicMessage['role'];
  authorName: string;
  content: string;
  createdAt?: string;
  tools?: StoredToolRun[];
}

export interface AgentMemoryDocument {
  id: string;
  agentId: string;
  title: string;
  content: string;
  memoryScope: MemoryScope;
  sourceType: MemorySourceType;
  importanceScore: number;
  topicId?: string;
  eventDate?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TopicWorkspace {
  agent: AgentProfile;
  topic: TopicSummary;
  messages: TopicMessage[];
  memoryDocuments: AgentMemoryDocument[];
}

export interface WorkspaceSearchResult {
  type: 'topic' | 'message';
  topicId: string;
  agentId: string;
  agentName: string;
  topicTitle: string;
  preview: string;
  createdAt?: string;
}

type SqlRow = Record<string, unknown>;

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `${prefix}_${uuid ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
}

function mapRows<T = SqlRow>(result: QueryExecResult[]): T[] {
  if (result.length === 0) {
    return [];
  }

  const entry = result[0]!;
  return entry.values.map((row) => {
    const mapped: SqlRow = {};
    entry.columns.forEach((column, index) => {
      mapped[column] = row[index];
    });
    return mapped as T;
  });
}

function getScalar(database: Database, query: string, params: SqlValue[] = []): unknown {
  const result = database.exec(query, params);
  if (result.length === 0 || result[0]!.values.length === 0) {
    return null;
  }

  return result[0]!.values[0]![0];
}

function getMemoryDocumentLayer(document: Pick<AgentMemoryDocument, 'memoryScope' | 'updatedAt'>, now: string): MemoryRetrievalLayer {
  if (document.memoryScope === 'global') {
    return 'global';
  }

  return resolveMemoryTier(document.updatedAt, now);
}

function selectMemoryDocumentsByLayers(
  documents: AgentMemoryDocument[],
  layers: MemoryRetrievalLayer[],
  now: string,
) {
  const allowedLayers = new Set(layers);
  return documents.filter((document) => allowedLayers.has(getMemoryDocumentLayer(document, now)));
}

function countNonGlobalMemoryDocuments(documents: AgentMemoryDocument[]) {
  return documents.reduce((count, document) => count + (document.memoryScope === 'global' ? 0 : 1), 0);
}

function mergeDistinctMemoryDocuments(base: AgentMemoryDocument[], additions: AgentMemoryDocument[]) {
  const merged: AgentMemoryDocument[] = [];
  const seen = new Set<string>();

  [...base, ...additions].forEach((document) => {
    if (seen.has(document.id)) {
      return;
    }

    seen.add(document.id);
    merged.push(document);
  });

  return merged;
}

function toBoolean(value: unknown): boolean {
  return value === 1 || value === '1' || value === true;
}

function parseTools(raw: unknown): StoredToolRun[] | undefined {
  if (typeof raw !== 'string' || !raw.trim()) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StoredToolRun[]) : undefined;
  } catch {
    return undefined;
  }
}

function toAgentProfile(row: {
  id: string;
  slug: string;
  name: string;
  description: string;
  system_prompt: string;
  provider_id: string | null;
  model: string | null;
  accent_color: string;
  workspace_relpath: string;
  is_default: number;
  created_at: string;
  updated_at: string;
}): AgentProfile {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    systemPrompt: row.system_prompt,
    providerId: row.provider_id ?? undefined,
    model: row.model ?? undefined,
    accentColor: row.accent_color,
    workspaceRelpath: row.workspace_relpath,
    isDefault: toBoolean(row.is_default),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toTopicSummary(row: {
  id: string;
  agent_id: string;
  title: string;
  title_source: 'auto' | 'manual';
  preview: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string;
  message_count: number;
}): TopicSummary {
  return {
    id: row.id,
    agentId: row.agent_id,
    title: row.title,
    titleSource: row.title_source,
    preview: formatTopicPreview(String(row.preview ?? '')),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastMessageAt: row.last_message_at,
    messageCount: Number(row.message_count) || 0,
  };
}

function toTopicMessage(row: {
  id: string;
  topic_id: string;
  agent_id: string;
  role: TopicMessage['role'];
  author_name: string;
  content: string;
  tools_json: string | null;
  created_at: string;
}): TopicMessage {
  return {
    id: row.id,
    topicId: row.topic_id,
    agentId: row.agent_id,
    role: row.role,
    authorName: row.author_name,
    content: row.content,
    createdAt: row.created_at,
    tools: parseTools(row.tools_json),
  };
}

function toAgentMemoryDocument(row: {
  id: string;
  agent_id: string;
  title: string;
  content: string;
  memory_scope: MemoryScope;
  source_type: MemorySourceType;
  importance_score: number;
  topic_id: string | null;
  event_date: string | null;
  created_at: string;
  updated_at: string;
}): AgentMemoryDocument {
  return {
    id: row.id,
    agentId: row.agent_id,
    title: row.title,
    content: row.content,
    memoryScope: row.memory_scope ?? 'global',
    sourceType: row.source_type ?? 'manual',
    importanceScore: Number(row.importance_score) || 3,
    topicId: row.topic_id ?? undefined,
    eventDate: row.event_date ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getAgentRow(database: Database, agentId: string): AgentProfile | null {
  const row = mapRows<{
    id: string;
    slug: string;
    name: string;
    description: string;
    system_prompt: string;
    provider_id: string | null;
    model: string | null;
    accent_color: string;
    workspace_relpath: string;
    is_default: number;
    created_at: string;
    updated_at: string;
  }>(
    database.exec(
      `
        SELECT
          id,
          slug,
          name,
          description,
          system_prompt,
          provider_id,
          model,
          accent_color,
          workspace_relpath,
          is_default,
          created_at,
          updated_at
        FROM agents
        WHERE id = ?
        LIMIT 1
      `,
      [agentId],
    ),
  )[0];

  return row ? toAgentProfile(row) : null;
}

function getDefaultAgent(database: Database): AgentProfile {
  const row = mapRows<{
    id: string;
    slug: string;
    name: string;
    description: string;
    system_prompt: string;
    provider_id: string | null;
    model: string | null;
    accent_color: string;
    workspace_relpath: string;
    is_default: number;
    created_at: string;
    updated_at: string;
  }>(
    database.exec(`
      SELECT
        id,
        slug,
        name,
        description,
        system_prompt,
        provider_id,
        model,
        accent_color,
        workspace_relpath,
        is_default,
        created_at,
        updated_at
      FROM agents
      ORDER BY is_default DESC, created_at ASC
      LIMIT 1
    `),
  )[0];

  if (!row) {
    throw new Error('No agents are available.');
  }

  return toAgentProfile(row);
}

function buildLikePatterns(query: string): string[] {
  return query
    .trim()
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => `%${part}%`);
}

function buildMatchQuery(query: string): string {
  return query
    .trim()
    .split(/\s+/)
    .map((part) => part.replace(/["']/g, '').trim())
    .filter((part) => part.length > 0)
    .map((part) => `"${part}"*`)
    .join(' OR ');
}

async function resolveAgentIdForMemorySync(database: Database, preferredAgentId?: string | null): Promise<string | null> {
  if (preferredAgentId) {
    return preferredAgentId;
  }

  const storedAgentId = await localforage.getItem<string>(ACTIVE_AGENT_KEY);
  const agents = mapRows<{ id: string }>(
    database.exec(`
      SELECT id
      FROM agents
      ORDER BY is_default DESC, created_at ASC
    `),
  );

  return resolveActiveAgentId(
    storedAgentId,
    agents.map((agent) => agent.id),
  );
}

export async function syncCurrentAgentMemory(options?: {
  database?: Database;
  agentId?: string | null;
  fileStore?: ReturnType<typeof getAgentMemoryFileStore>;
  now?: string;
  persist?: boolean;
  strict?: boolean;
}) {
  const database = options?.database ?? (await ensureAgentSchema());
  const fileStore = options?.fileStore ?? getAgentMemoryFileStore();
  if (!fileStore) {
    return null;
  }

  const resolvedAgentId = await resolveAgentIdForMemorySync(database, options?.agentId);
  if (!resolvedAgentId) {
    return null;
  }

  const agent = getAgentRow(database, resolvedAgentId);
  if (!agent) {
    return null;
  }

  let result = null;
  try {
    result = await syncAgentMemoryFromStore(database, {
      agentId: agent.id,
      agentSlug: agent.slug,
      fileStore,
      now: options?.now,
    });
  } catch (error) {
    if (options?.strict) {
      throw error;
    }

    console.warn(`Skipping agent memory file sync for ${agent.slug}:`, error);
    return null;
  }

  if (result.changed && (options?.persist ?? !options?.database)) {
    await saveDB();
  }

  return result;
}

async function ensureAgentSchema(): Promise<Database> {
  const database = await initDB();
  if (!ensuredPromise) {
    ensuredPromise = (async () => {
      try {
        ensureAgentWorkspaceSchema(database);

        try {
          database.run(`
            CREATE VIRTUAL TABLE IF NOT EXISTS topic_title_fts USING fts5(
              topic_id UNINDEXED,
              agent_id UNINDEXED,
              title
            );
          `);
          database.run(`
            CREATE VIRTUAL TABLE IF NOT EXISTS message_content_fts USING fts5(
              message_id UNINDEXED,
              topic_id UNINDEXED,
              agent_id UNINDEXED,
              content
            );
          `);
          fts5Available = true;
        } catch {
          fts5Available = false;
        }

        const migrated = await migrateLegacyWorkspace(database);
        const seeded = seedFallbackWorkspace(database);
        const syncResult = await syncCurrentAgentMemory({
          database,
          persist: false,
        });

        if (migrated || seeded || syncResult?.changed) {
          await saveDB();
        }
      } catch (error) {
        ensuredPromise = null;
        throw error;
      }
    })();
  }

  await ensuredPromise;
  return database;
}

function seedFallbackWorkspace(database: Database): boolean {
  const agentCount = Number(getScalar(database, 'SELECT COUNT(*) FROM agents') ?? 0);
  if (agentCount > 0) {
    return false;
  }

  const timestamp = nowIso();
  const workspaceRelpath = buildAgentWorkspacePath(FALLBACK_AGENT_SEED.name);
  database.run(
    `
      INSERT INTO agents (
        id,
        slug,
        name,
        description,
        system_prompt,
        provider_id,
        model,
        accent_color,
        workspace_relpath,
        is_default,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      FALLBACK_AGENT_SEED.id,
      workspaceRelpath.replace(/^agents\//, ''),
      FALLBACK_AGENT_SEED.name,
      FALLBACK_AGENT_SEED.description,
      FALLBACK_AGENT_SEED.systemPrompt,
      null,
      null,
      FALLBACK_AGENT_SEED.accentColor,
      workspaceRelpath,
      1,
      timestamp,
      timestamp,
    ],
  );
  database.run(
    `
      INSERT INTO topics (
        id,
        agent_id,
        title,
        title_source,
        created_at,
        updated_at,
        last_message_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [createId('topic'), FALLBACK_AGENT_SEED.id, DEFAULT_TOPIC_TITLE, 'auto', timestamp, timestamp, timestamp],
  );

  if (fts5Available) {
    rebuildFtsIndexes(database);
  }

  return true;
}

async function migrateLegacyWorkspace(database: Database): Promise<boolean> {
  const agentCount = Number(getScalar(database, 'SELECT COUNT(*) FROM agents') ?? 0);
  if (agentCount > 0) {
    return false;
  }

  const assistants = mapRows<{
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

  database.run('BEGIN');
  try {
    assistants.forEach((assistant, index) => {
      const workspaceRelpath = buildAgentWorkspacePath(assistant.name);
      database.run(
        `
          INSERT INTO agents (
            id,
            slug,
            name,
            description,
            system_prompt,
            provider_id,
            model,
            accent_color,
            workspace_relpath,
            is_default,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          assistant.id,
          workspaceRelpath.replace(/^agents\//, ''),
          assistant.name,
          assistant.description,
          assistant.system_prompt,
          assistant.provider_id ?? null,
          assistant.model ?? null,
          assistant.accent_color,
          workspaceRelpath,
          assistant.is_default || (index === 0 ? 1 : 0),
          assistant.created_at,
          assistant.updated_at,
        ],
      );
    });

    const defaultAgentId = assistants[0]?.id;
    if (defaultAgentId) {
      const legacyMemoryDocuments = mapRows<{
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

      legacyMemoryDocuments.forEach((document) => {
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
            defaultAgentId,
            document.title,
            document.content,
            'global',
            'manual',
            5,
            null,
            null,
            document.created_at,
            document.updated_at,
          ],
        );
      });
    }

    const conversations = mapRows<{
      id: string;
      title: string;
      created_at: string;
      updated_at: string;
    }>(
      database.exec(`
        SELECT id, title, created_at, updated_at
        FROM conversations
        ORDER BY created_at ASC
      `),
    );

    conversations.forEach((conversation) => {
      const lanes = mapRows<{
        id: string;
        assistant_id: string;
        name: string;
        created_at: string;
      }>(
        database.exec(
          `
            SELECT id, assistant_id, name, created_at
            FROM agent_lanes
            WHERE conversation_id = ?
            ORDER BY position ASC, created_at ASC
          `,
          [conversation.id],
        ),
      );

      if (lanes.length === 0 && assistants[0]) {
        lanes.push({
          id: createId('legacy_lane'),
          assistant_id: assistants[0]!.id,
          name: assistants[0]!.name,
          created_at: conversation.created_at,
        });
      }

      const hadMultipleLanes = lanes.length > 1;
      lanes.forEach((lane) => {
        const topicId = createId('topic');
        const agentId = getAgentRow(database, lane.assistant_id)?.id ?? defaultAgentId;
        if (!agentId) {
          return;
        }

        const messages = mapRows<{
          id: string;
          role: TopicMessage['role'];
          author_name: string;
          content: string;
          tools_json: string | null;
          created_at: string;
        }>(
          database.exec(
            `
              SELECT id, role, author_name, content, tools_json, created_at
              FROM chat_messages
              WHERE conversation_id = ? AND lane_id = ?
              ORDER BY created_at ASC
            `,
            [conversation.id, lane.id],
          ),
        );

        const lastMessageAt = messages[messages.length - 1]?.created_at ?? conversation.updated_at;
        database.run(
          `
            INSERT INTO topics (
              id,
              agent_id,
              title,
              title_source,
              created_at,
              updated_at,
              last_message_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `,
          [
            topicId,
            agentId,
            buildMigratedTopicTitle(conversation.title, lane.name, hadMultipleLanes),
            'manual',
            conversation.created_at,
            conversation.updated_at,
            lastMessageAt,
          ],
        );

        messages.forEach((message) => {
          database.run(
            `
              INSERT INTO topic_messages (
                id,
                topic_id,
                agent_id,
                role,
                author_name,
                content,
                tools_json,
                created_at
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
              `topic_${message.id}`,
              topicId,
              agentId,
              message.role,
              message.author_name,
              message.content,
              message.tools_json,
              message.created_at,
            ],
          );
        });
      });
    });

    const topicCount = Number(getScalar(database, 'SELECT COUNT(*) FROM topics') ?? 0);
    if (topicCount === 0) {
      const defaultAgent = getDefaultAgent(database);
      const timestamp = nowIso();
      database.run(
        `
          INSERT INTO topics (
            id,
            agent_id,
            title,
            title_source,
            created_at,
            updated_at,
            last_message_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        [createId('topic'), defaultAgent.id, DEFAULT_TOPIC_TITLE, 'auto', timestamp, timestamp, timestamp],
      );
    }

    if (fts5Available) {
      rebuildFtsIndexes(database);
    }

    database.run('COMMIT');
    return true;
  } catch (error) {
    database.run('ROLLBACK');
    throw error;
  }
}

function rebuildFtsIndexes(database: Database) {
  if (!fts5Available) {
    return;
  }

  database.run('DELETE FROM topic_title_fts');
  database.run('DELETE FROM message_content_fts');

  const topicRows = mapRows<{
    id: string;
    agent_id: string;
    title: string;
  }>(
    database.exec(`
      SELECT id, agent_id, title
      FROM topics
    `),
  );
  topicRows.forEach((topic) => {
    database.run(
      'INSERT INTO topic_title_fts (topic_id, agent_id, title) VALUES (?, ?, ?)',
      [topic.id, topic.agent_id, topic.title],
    );
  });

  const messageRows = mapRows<{
    id: string;
    topic_id: string;
    agent_id: string;
    content: string;
  }>(
    database.exec(`
      SELECT id, topic_id, agent_id, content
      FROM topic_messages
    `),
  );
  messageRows.forEach((message) => {
    database.run(
      'INSERT INTO message_content_fts (message_id, topic_id, agent_id, content) VALUES (?, ?, ?, ?)',
      [message.id, message.topic_id, message.agent_id, message.content],
    );
  });
}

async function persistAndMaybeRebuildFts(database: Database) {
  if (fts5Available) {
    rebuildFtsIndexes(database);
  }
  await saveDB();
}

export async function getSearchCapabilities() {
  await ensureAgentSchema();
  return { fts5Available: Boolean(fts5Available) };
}

export async function listAgents(): Promise<AgentProfile[]> {
  const database = await ensureAgentSchema();
  const rows = mapRows<{
    id: string;
    slug: string;
    name: string;
    description: string;
    system_prompt: string;
    provider_id: string | null;
    model: string | null;
    accent_color: string;
    workspace_relpath: string;
    is_default: number;
    created_at: string;
    updated_at: string;
  }>(
    database.exec(`
      SELECT
        id,
        slug,
        name,
        description,
        system_prompt,
        provider_id,
        model,
        accent_color,
        workspace_relpath,
        is_default,
        created_at,
        updated_at
      FROM agents
      ORDER BY is_default DESC, created_at ASC
    `),
  );

  return rows.map(toAgentProfile);
}

export async function saveAgent(
  draft: Omit<AgentProfile, 'slug' | 'workspaceRelpath' | 'createdAt' | 'updatedAt' | 'isDefault'> & {
    isDefault?: boolean;
    workspaceRelpath?: string;
  },
): Promise<AgentProfile> {
  const database = await ensureAgentSchema();
  const timestamp = nowIso();
  const id = draft.id || createId('agent');
  const workspaceRelpath = draft.workspaceRelpath?.trim() || buildAgentWorkspacePath(draft.name);
  const slug = workspaceRelpath.replace(/^agents\//, '') || id;
  const exists = Number(getScalar(database, 'SELECT COUNT(*) FROM agents WHERE id = ?', [id]) ?? 0);

  database.run('BEGIN');
  try {
    if (draft.isDefault) {
      database.run('UPDATE agents SET is_default = 0');
    }

    if (exists > 0) {
      database.run(
        `
          UPDATE agents
          SET
            slug = ?,
            name = ?,
            description = ?,
            system_prompt = ?,
            provider_id = ?,
            model = ?,
            accent_color = ?,
            workspace_relpath = ?,
            is_default = ?,
            updated_at = ?
          WHERE id = ?
        `,
        [
          slug,
          draft.name.trim(),
          draft.description.trim(),
          draft.systemPrompt.trim(),
          draft.providerId ?? null,
          draft.model ?? null,
          draft.accentColor,
          workspaceRelpath,
          draft.isDefault ? 1 : 0,
          timestamp,
          id,
        ],
      );
    } else {
      database.run(
        `
          INSERT INTO agents (
            id,
            slug,
            name,
            description,
            system_prompt,
            provider_id,
            model,
            accent_color,
            workspace_relpath,
            is_default,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          id,
          slug,
          draft.name.trim(),
          draft.description.trim(),
          draft.systemPrompt.trim(),
          draft.providerId ?? null,
          draft.model ?? null,
          draft.accentColor,
          workspaceRelpath,
          draft.isDefault ? 1 : 0,
          timestamp,
          timestamp,
        ],
      );
    }

    database.run('COMMIT');
  } catch (error) {
    database.run('ROLLBACK');
    throw error;
  }

  await persistAndMaybeRebuildFts(database);
  const agent = getAgentRow(database, id);
  if (!agent) {
    throw new Error('Failed to save agent.');
  }
  return agent;
}

export async function getActiveAgentId(): Promise<string | null> {
  await ensureAgentSchema();
  const stored = await localforage.getItem<string>(ACTIVE_AGENT_KEY);
  const agents = await listAgents();
  const resolved = resolveActiveAgentId(
    stored,
    agents.map((agent) => agent.id),
  );

  if (stored !== resolved) {
    if (resolved) {
      await localforage.setItem(ACTIVE_AGENT_KEY, resolved);
    } else {
      await localforage.removeItem(ACTIVE_AGENT_KEY);
    }
  }

  return resolved;
}

export async function setActiveAgentId(agentId: string) {
  await localforage.setItem(ACTIVE_AGENT_KEY, agentId);
  await syncCurrentAgentMemory({ agentId });
}

export async function getActiveTopicId(): Promise<string | null> {
  await ensureAgentSchema();
  return (await localforage.getItem<string>(ACTIVE_TOPIC_KEY)) ?? null;
}

export async function setActiveTopicId(topicId: string) {
  await localforage.setItem(ACTIVE_TOPIC_KEY, topicId);
}

export async function listTopics(agentId: string): Promise<TopicSummary[]> {
  const database = await ensureAgentSchema();
  const rows = mapRows<{
    id: string;
    agent_id: string;
    title: string;
    title_source: 'auto' | 'manual';
    preview: string | null;
    created_at: string;
    updated_at: string;
    last_message_at: string;
    message_count: number;
  }>(
    database.exec(
      `
        SELECT
          t.id,
          t.agent_id,
          t.title,
          t.title_source,
          (
            SELECT content
            FROM topic_messages
            WHERE topic_id = t.id
            ORDER BY created_at DESC
            LIMIT 1
          ) AS preview,
          t.created_at,
          t.updated_at,
          t.last_message_at,
          (
            SELECT COUNT(*)
            FROM topic_messages
            WHERE topic_id = t.id
          ) AS message_count
        FROM topics t
        WHERE t.agent_id = ?
        ORDER BY t.last_message_at DESC, t.updated_at DESC, t.created_at DESC
      `,
      [agentId],
    ),
  );

  return rows.map(toTopicSummary);
}

export async function createTopic(options: { agentId: string; title?: string }): Promise<TopicSummary> {
  const database = await ensureAgentSchema();
  const timestamp = nowIso();
  const topicId = createId('topic');
  const title = options.title?.trim() || DEFAULT_TOPIC_TITLE;
  const titleSource = options.title?.trim() ? 'manual' : 'auto';

  database.run(
    `
      INSERT INTO topics (
        id,
        agent_id,
        title,
        title_source,
        created_at,
        updated_at,
        last_message_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [topicId, options.agentId, title, titleSource, timestamp, timestamp, timestamp],
  );
  await persistAndMaybeRebuildFts(database);

  const topic = mapRows<{
    id: string;
    agent_id: string;
    title: string;
    title_source: 'auto' | 'manual';
    preview: string | null;
    created_at: string;
    updated_at: string;
    last_message_at: string;
    message_count: number;
  }>(
    database.exec(
      `
        SELECT
          id,
          agent_id,
          title,
          title_source,
          '' AS preview,
          created_at,
          updated_at,
          last_message_at,
          0 AS message_count
        FROM topics
        WHERE id = ?
        LIMIT 1
      `,
      [topicId],
    ),
  )[0];

  if (!topic) {
    throw new Error('Failed to create topic.');
  }

  return toTopicSummary(topic);
}

export async function updateTopicTitle(topicId: string, title: string): Promise<void> {
  const database = await ensureAgentSchema();
  const normalizedTitle = title.trim() || DEFAULT_TOPIC_TITLE;
  database.run(
    `
      UPDATE topics
      SET
        title = ?,
        title_source = 'manual',
        updated_at = ?
      WHERE id = ?
    `,
    [normalizedTitle, nowIso(), topicId],
  );
  await persistAndMaybeRebuildFts(database);
}

export async function getTopicWorkspace(topicId: string): Promise<TopicWorkspace | null> {
  const database = await ensureAgentSchema();
  const topicRow = mapRows<{
    id: string;
    agent_id: string;
    title: string;
    title_source: 'auto' | 'manual';
    preview: string | null;
    created_at: string;
    updated_at: string;
    last_message_at: string;
    message_count: number;
  }>(
    database.exec(
      `
        SELECT
          t.id,
          t.agent_id,
          t.title,
          t.title_source,
          (
            SELECT content
            FROM topic_messages
            WHERE topic_id = t.id
            ORDER BY created_at DESC
            LIMIT 1
          ) AS preview,
          t.created_at,
          t.updated_at,
          t.last_message_at,
          (
            SELECT COUNT(*)
            FROM topic_messages
            WHERE topic_id = t.id
          ) AS message_count
        FROM topics t
        WHERE t.id = ?
        LIMIT 1
      `,
      [topicId],
    ),
  )[0];

  if (!topicRow) {
    return null;
  }

  await syncCurrentAgentMemory({
    database,
    agentId: topicRow.agent_id,
    persist: true,
  });

  const agent = getAgentRow(database, topicRow.agent_id);
  if (!agent) {
    return null;
  }

  const messageRows = mapRows<{
    id: string;
    topic_id: string;
    agent_id: string;
    role: TopicMessage['role'];
    author_name: string;
    content: string;
    tools_json: string | null;
    created_at: string;
  }>(
    database.exec(
      `
        SELECT id, topic_id, agent_id, role, author_name, content, tools_json, created_at
        FROM topic_messages
        WHERE topic_id = ?
        ORDER BY created_at ASC
      `,
      [topicId],
    ),
  );

  const memoryRows = mapRows<{
    id: string;
    agent_id: string;
    title: string;
    content: string;
    memory_scope: MemoryScope;
    source_type: MemorySourceType;
    importance_score: number;
    topic_id: string | null;
    event_date: string | null;
    created_at: string;
    updated_at: string;
  }>(
    database.exec(
      `
        SELECT
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
        FROM agent_memory_documents
        WHERE agent_id = ?
          AND memory_scope = 'global'
        ORDER BY updated_at DESC, created_at DESC
      `,
      [agent.id],
    ),
  );

  return {
    agent,
    topic: toTopicSummary(topicRow),
    messages: messageRows.map(toTopicMessage),
    memoryDocuments: memoryRows.map(toAgentMemoryDocument),
  };
}

function appendMemoryLine(existingContent: string, line: string) {
  const trimmed = existingContent.trim();
  return trimmed ? `${trimmed}\n${line}` : line;
}

function dateKeyFromIso(timestamp: string) {
  return timestamp.slice(0, 10);
}

function upsertDailyMemoryLog(
  database: Database,
  input: {
    agentId: string;
    topicId: string;
    topicTitle: string;
    authorName: string;
    content: string;
    createdAt: string;
  },
) {
  const eventDate = dateKeyFromIso(input.createdAt);
  const line = buildConversationMemoryEntry({
    topicTitle: input.topicTitle,
    authorName: input.authorName,
    createdAt: input.createdAt,
    content: input.content,
  });
  const importanceScore = scoreMemoryImportance(input.content, 'conversation_log');
  const existing = mapRows<{
    id: string;
    content: string;
    importance_score: number;
  }>(
    database.exec(
      `
        SELECT id, content, importance_score
        FROM agent_memory_documents
        WHERE agent_id = ?
          AND memory_scope = 'daily'
          AND event_date = ?
        LIMIT 1
      `,
      [input.agentId, eventDate],
    ),
  )[0];

  if (existing) {
    database.run(
      `
        UPDATE agent_memory_documents
        SET
          content = ?,
          importance_score = ?,
          updated_at = ?
        WHERE id = ?
      `,
      [
        appendMemoryLine(existing.content, line),
        Math.max(Number(existing.importance_score) || 0, importanceScore),
        input.createdAt,
        existing.id,
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
      createId('memory'),
      input.agentId,
      `${eventDate} Activity Log`,
      line,
      'daily',
      'conversation_log',
      importanceScore,
      input.topicId,
      eventDate,
      input.createdAt,
      input.createdAt,
    ],
  );
}

function upsertPromotedMemory(
  database: Database,
  input: {
    agentId: string;
    topicId: string;
    content: string;
    createdAt: string;
  },
) {
  const normalizedTitle = buildMemoryPromotionTitle(input.content);
  const id = buildPromotionFingerprint(`${input.agentId}:${input.content}`);
  const importanceScore = scoreMemoryImportance(input.content, 'promotion');
  const existing = Number(
    getScalar(database, 'SELECT COUNT(*) FROM agent_memory_documents WHERE id = ?', [id]) ?? 0,
  );

  if (existing > 0) {
    database.run(
      `
        UPDATE agent_memory_documents
        SET
          title = ?,
          content = ?,
          importance_score = ?,
          topic_id = ?,
          updated_at = ?
        WHERE id = ?
      `,
      [normalizedTitle, input.content.trim(), importanceScore, input.topicId, input.createdAt, id],
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
      id,
      input.agentId,
      normalizedTitle,
      input.content.trim(),
      'global',
      'promotion',
      importanceScore,
      input.topicId,
      null,
      input.createdAt,
      input.createdAt,
    ],
  );
}

function recordMemoryFromMessages(database: Database, messages: TopicMessageInput[]) {
  const topicIds = [...new Set(messages.map((message) => message.topicId))];
  const topicRows = mapRows<{ id: string; title: string }>(
    database.exec(
      `
        SELECT id, title
        FROM topics
        WHERE id IN (${topicIds.map(() => '?').join(', ')})
      `,
      topicIds,
    ),
  );
  const topicTitles = new Map(topicRows.map((topic) => [topic.id, topic.title]));

  messages.forEach((message) => {
    if ((message.role !== 'user' && message.role !== 'assistant') || !message.content.trim()) {
      return;
    }

    const createdAt = message.createdAt ?? nowIso();
    const topicTitle = topicTitles.get(message.topicId) ?? DEFAULT_TOPIC_TITLE;
    upsertDailyMemoryLog(database, {
      agentId: message.agentId,
      topicId: message.topicId,
      topicTitle,
      authorName: message.authorName,
      content: message.content,
      createdAt,
    });

    if (shouldPromoteMemory(message.content, message.role)) {
      upsertPromotedMemory(database, {
        agentId: message.agentId,
        topicId: message.topicId,
        content: message.content,
        createdAt,
      });
    }
  });
}

export async function addTopicMessages(messages: TopicMessageInput[]): Promise<void> {
  if (messages.length === 0) {
    return;
  }

  const database = await ensureAgentSchema();
  database.run('BEGIN');
  try {
    messages.forEach((message) => {
      const createdAt = message.createdAt ?? nowIso();
      database.run(
        `
          INSERT INTO topic_messages (
            id,
            topic_id,
            agent_id,
            role,
            author_name,
            content,
            tools_json,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          message.id ?? createId('message'),
          message.topicId,
          message.agentId,
          message.role,
          message.authorName,
          message.content,
          message.tools ? JSON.stringify(message.tools) : null,
          createdAt,
        ],
      );

      database.run(
        `
          UPDATE topics
          SET
            updated_at = ?,
            last_message_at = ?
          WHERE id = ?
        `,
        [createdAt, createdAt, message.topicId],
      );
    });
    recordMemoryFromMessages(database, messages);
    database.run('COMMIT');
  } catch (error) {
    database.run('ROLLBACK');
    throw error;
  }

  await persistAndMaybeRebuildFts(database);
}

export async function maybeAutoTitleTopic(topicId: string, input: string): Promise<void> {
  const database = await ensureAgentSchema();
  const topic = mapRows<{ title_source: string; title: string }>(
    database.exec('SELECT title_source, title FROM topics WHERE id = ? LIMIT 1', [topicId]),
  )[0];
  if (!topic || topic.title_source !== 'auto' || topic.title !== DEFAULT_TOPIC_TITLE) {
    return;
  }

  const normalizedTitle = input
    .replace(/[#*_`>~-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48)
    .trim();

  if (!normalizedTitle) {
    return;
  }

  database.run(
    `
      UPDATE topics
      SET
        title = ?,
        updated_at = ?
      WHERE id = ?
    `,
    [normalizedTitle, nowIso(), topicId],
  );
  await persistAndMaybeRebuildFts(database);
}

export async function listAgentMemoryDocuments(
  agentId: string,
  options?: { scopes?: MemoryScope[]; now?: string },
): Promise<AgentMemoryDocument[]> {
  const database = await ensureAgentSchema();
  await syncCurrentAgentMemory({
    database,
    agentId,
    now: options?.now,
    persist: true,
  });
  const scopes = options?.scopes?.length ? options.scopes : (['global'] as MemoryScope[]);
  const placeholders = scopes.map(() => '?').join(', ');
  const rows = mapRows<{
    id: string;
    agent_id: string;
    title: string;
    content: string;
    memory_scope: MemoryScope;
    source_type: MemorySourceType;
    importance_score: number;
    topic_id: string | null;
    event_date: string | null;
    created_at: string;
    updated_at: string;
  }>(
    database.exec(
      `
        SELECT
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
        FROM agent_memory_documents
        WHERE agent_id = ?
          AND memory_scope IN (${placeholders})
        ORDER BY updated_at DESC, created_at DESC
      `,
      [agentId, ...scopes],
    ),
  );

  return rows.map(toAgentMemoryDocument);
}

export async function saveAgentMemoryDocument(draft: {
  id?: string;
  agentId: string;
  title: string;
  content: string;
  memoryScope?: MemoryScope;
  sourceType?: MemorySourceType;
  importanceScore?: number;
  topicId?: string;
  eventDate?: string;
}): Promise<AgentMemoryDocument> {
  const database = await ensureAgentSchema();
  const timestamp = nowIso();
  const id = draft.id || createId('memory');
  const exists = Number(getScalar(database, 'SELECT COUNT(*) FROM agent_memory_documents WHERE id = ?', [id]) ?? 0);
  const memoryScope = draft.memoryScope ?? 'global';
  const sourceType = draft.sourceType ?? 'manual';
  const importanceScore = draft.importanceScore ?? scoreMemoryImportance(draft.content, sourceType);

  if (exists > 0) {
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
        draft.title.trim() || 'Untitled Memory',
        draft.content,
        memoryScope,
        sourceType,
        importanceScore,
        draft.topicId ?? null,
        draft.eventDate ?? null,
        timestamp,
        id,
      ],
    );
  } else {
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
        id,
        draft.agentId,
        draft.title.trim() || 'Untitled Memory',
        draft.content,
        memoryScope,
        sourceType,
        importanceScore,
        draft.topicId ?? null,
        draft.eventDate ?? null,
        timestamp,
        timestamp,
      ],
    );
  }

  await persistAndMaybeRebuildFts(database);
  const row = mapRows<{
    id: string;
    agent_id: string;
    title: string;
    content: string;
    memory_scope: MemoryScope;
    source_type: MemorySourceType;
    importance_score: number;
    topic_id: string | null;
    event_date: string | null;
    created_at: string;
    updated_at: string;
  }>(
    database.exec(
      `
        SELECT
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
        FROM agent_memory_documents
        WHERE id = ?
        LIMIT 1
      `,
      [id],
    ),
  )[0];

  if (!row) {
    throw new Error('Failed to save agent memory document.');
  }

  return toAgentMemoryDocument(row);
}

export async function getAgentMemoryContext(
  agentId: string,
  options?: { includeRecentMemorySnapshot?: boolean; now?: string; query?: string },
): Promise<string> {
  const now = options?.now ?? new Date().toISOString();
  const documents = selectEffectiveMemoryDocuments(
    await listAgentMemoryDocuments(agentId, {
      scopes: ['global', 'daily', 'session'],
      now,
    }),
    { now },
  );

  const normalizedQuery = options?.query?.trim();
  let routedDocuments = documents;

  if (normalizedQuery) {
    const route = routeMemoryQuery(normalizedQuery, { now });
    const preferredDocuments = selectMemoryDocumentsByLayers(documents, route.preferredLayers, now);

    if (route.mode === 'default' && countNonGlobalMemoryDocuments(preferredDocuments) < 2) {
      routedDocuments = mergeDistinctMemoryDocuments(
        preferredDocuments,
        selectMemoryDocumentsByLayers(documents, route.fallbackLayers, now),
      );
    } else {
      routedDocuments = preferredDocuments;
    }
  }

  return formatLayeredMemoryContext(routedDocuments, {
    includeRecentMemorySnapshot: options?.includeRecentMemorySnapshot,
    now,
  });
}

export async function deleteAgentMemoryDocument(id: string): Promise<void> {
  const database = await ensureAgentSchema();
  database.run('DELETE FROM agent_memory_documents WHERE id = ?', [id]);
  await persistAndMaybeRebuildFts(database);
}

export async function searchWorkspace(query: string, options?: { agentId?: string }): Promise<WorkspaceSearchResult[]> {
  const database = await ensureAgentSchema();
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return [];
  }

  const results: WorkspaceSearchResult[] = [];
  const agentId = options?.agentId?.trim();

  if (fts5Available) {
    const matchQuery = buildMatchQuery(normalizedQuery);
    if (matchQuery) {
      const topicRows = mapRows<{
        topic_id: string;
        agent_id: string;
        topic_title: string;
        agent_name: string;
      }>(
        database.exec(
          `
            SELECT
              f.topic_id,
              f.agent_id,
              t.title AS topic_title,
              a.name AS agent_name
            FROM topic_title_fts f
            JOIN topics t ON t.id = f.topic_id
            JOIN agents a ON a.id = f.agent_id
            WHERE f.title MATCH ?
              ${agentId ? 'AND f.agent_id = ?' : ''}
            LIMIT 8
          `,
          agentId ? [matchQuery, agentId] : [matchQuery],
        ),
      );

      topicRows.forEach((row) => {
        results.push({
          type: 'topic',
          topicId: row.topic_id,
          agentId: row.agent_id,
          agentName: row.agent_name,
          topicTitle: row.topic_title,
          preview: row.topic_title,
        });
      });

      const messageRows = mapRows<{
        message_id: string;
        topic_id: string;
        agent_id: string;
        content: string;
        topic_title: string;
        agent_name: string;
      }>(
        database.exec(
          `
            SELECT
              f.message_id,
              f.topic_id,
              f.agent_id,
              m.content,
              t.title AS topic_title,
              a.name AS agent_name
            FROM message_content_fts f
            JOIN topic_messages m ON m.id = f.message_id
            JOIN topics t ON t.id = f.topic_id
            JOIN agents a ON a.id = f.agent_id
            WHERE f.content MATCH ?
              ${agentId ? 'AND f.agent_id = ?' : ''}
            LIMIT 12
          `,
          agentId ? [matchQuery, agentId] : [matchQuery],
        ),
      );

      messageRows.forEach((row) => {
        results.push({
          type: 'message',
          topicId: row.topic_id,
          agentId: row.agent_id,
          agentName: row.agent_name,
          topicTitle: row.topic_title,
          preview: formatTopicPreview(row.content).slice(0, 180),
        });
      });
    }
  }

  if (results.length === 0) {
    const patterns = buildLikePatterns(normalizedQuery);
    if (patterns.length === 0) {
      return [];
    }

    const titleConditions = patterns.map(() => 't.title LIKE ?').join(' OR ');
    const titleParams = patterns.map((pattern) => pattern);
    const topicRows = mapRows<{
      topic_id: string;
      agent_id: string;
      topic_title: string;
      agent_name: string;
    }>(
      database.exec(
        `
          SELECT
            t.id AS topic_id,
            t.agent_id,
            t.title AS topic_title,
            a.name AS agent_name
          FROM topics t
          JOIN agents a ON a.id = t.agent_id
          WHERE (${titleConditions})
            ${agentId ? 'AND t.agent_id = ?' : ''}
          ORDER BY t.last_message_at DESC
          LIMIT 8
        `,
        agentId ? [...titleParams, agentId] : titleParams,
      ),
    );

    topicRows.forEach((row) => {
      results.push({
        type: 'topic',
        topicId: row.topic_id,
        agentId: row.agent_id,
        agentName: row.agent_name,
        topicTitle: row.topic_title,
        preview: row.topic_title,
      });
    });

    const messageConditions = patterns.map(() => 'm.content LIKE ?').join(' OR ');
    const messageRows = mapRows<{
      topic_id: string;
      agent_id: string;
      content: string;
      created_at: string;
      topic_title: string;
      agent_name: string;
    }>(
      database.exec(
        `
          SELECT
            m.topic_id,
            m.agent_id,
            m.content,
            m.created_at,
            t.title AS topic_title,
            a.name AS agent_name
          FROM topic_messages m
          JOIN topics t ON t.id = m.topic_id
          JOIN agents a ON a.id = m.agent_id
          WHERE (${messageConditions})
            ${agentId ? 'AND m.agent_id = ?' : ''}
          ORDER BY m.created_at DESC
          LIMIT 12
        `,
        agentId ? [...patterns, agentId] : patterns,
      ),
    );

    messageRows.forEach((row) => {
      results.push({
        type: 'message',
        topicId: row.topic_id,
        agentId: row.agent_id,
        agentName: row.agent_name,
        topicTitle: row.topic_title,
        preview: formatTopicPreview(row.content).slice(0, 180),
        createdAt: row.created_at,
      });
    });
  }

  const deduped = new Map<string, WorkspaceSearchResult>();
  results.forEach((result) => {
    const key = `${result.type}:${result.topicId}:${result.preview}`;
    if (!deduped.has(key)) {
      deduped.set(key, result);
    }
  });

  return [...deduped.values()].slice(0, 16);
}

export async function getOrCreateActiveTopic(agentId: string): Promise<TopicSummary> {
  const currentTopicId = await getActiveTopicId();
  if (currentTopicId) {
    const workspace = await getTopicWorkspace(currentTopicId);
    if (workspace && workspace.agent.id === agentId) {
      return workspace.topic;
    }
  }

  const topics = await listTopics(agentId);
  if (topics[0]) {
    await setActiveTopicId(topics[0]!.id);
    return topics[0]!;
  }

  const created = await createTopic({ agentId });
  await setActiveTopicId(created.id);
  return created;
}

export async function ensureAgentWorkspaceBootstrap() {
  const agentId = await getActiveAgentId();
  if (!agentId) {
    return null;
  }

  const agent = (await listAgents()).find((entry) => entry.id === agentId) ?? null;
  if (!agent) {
    return null;
  }

  const topic = await getOrCreateActiveTopic(agent.id);
  return { agent, topic };
}

export function getDefaultTopicPreview() {
  return DEFAULT_TOPIC_PREVIEW;
}
