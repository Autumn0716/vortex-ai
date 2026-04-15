import localforage from 'localforage';
import { getAgentConfig } from './agent/config';
import {
  buildSemanticCacheKey,
  buildDocumentKnowledgeGraph,
  chunkDocumentContent,
  compressRetrievedContext,
  decomposeTaskQuery,
  expandKnowledgeSearchQueries,
  extractKnowledgeGraphEntities,
  planCorrectiveKnowledgeQueries,
  scoreRetrievedContextSupport,
} from './local-rag-helpers';
import {
  classifyKnowledgeDocument,
  normalizeKnowledgeTags,
  type KnowledgeDocumentSourceType,
} from './knowledge-document-model';
import { createFts5Table, hasFts5Table } from './db-fts5-helpers';
import {
  buildEmbeddingContentHash,
  createEmbeddings,
  DEFAULT_EMBEDDING_BASE_URL,
  DEFAULT_EMBEDDING_DIMENSIONS,
  DEFAULT_EMBEDDING_MODEL,
  type EmbeddingProviderConfig,
} from './embedding-client';
import { cosineSimilarity, hybridScoreDocuments, rerankHybridDocuments } from './vector-search-model';
import { runDatabaseTransaction } from './db-transaction';
import { Database, initializeSqliteModule, type SQLiteModule, type SqlValue, type QueryExecResult } from './db-core';
import { getScalar, mapRows, toBoolean } from './db-row-helpers';
import type {
  AgentLane,
  AssistantProfile,
  AssistantSeed,
  CandidateCollectionMetrics,
  ChatMessage,
  ChatMessageInput,
  ConversationSummary,
  ConversationWorkspace,
  DataStats,
  DocumentChunkEmbeddingRow,
  DocumentSearchCandidate,
  DocumentSearchRow,
  GlobalMemoryDocument,
  KnowledgeDocumentRecord,
  KnowledgeDocumentSearchMetrics,
  KnowledgeDocumentSearchOptions,
  KnowledgeDocumentSearchResponse,
  KnowledgeDocumentSearchResult,
  KnowledgeDocumentSupportMetadata,
  KnowledgeEvidenceFeedbackInput,
  PromptSeed,
  PromptSnippet,
  RetrievedDocumentResult,
  StoredToolRun,
} from './db-types';

export { Database };
export type { QueryExecResult, SqlValue };
export type {
  AgentLane,
  AssistantProfile,
  ChatMessage,
  ChatMessageInput,
  ConversationSummary,
  ConversationWorkspace,
  DataStats,
  GlobalMemoryDocument,
  KnowledgeDocumentRecord,
  KnowledgeDocumentSearchMetrics,
  KnowledgeDocumentSearchOptions,
  KnowledgeDocumentSearchResponse,
  KnowledgeDocumentSearchResult,
  KnowledgeDocumentSupportMetadata,
  KnowledgeEvidenceFeedbackInput,
  KnowledgeEvidenceFeedbackValue,
  PromptSnippet,
  StoredToolRun,
} from './db-types';

let sqlite3Module: SQLiteModule | null = null;
let db: Database | null = null;
let initPromise: Promise<Database> | null = null;

function resetDatabaseConnectionState() {
  try {
    db?.close();
  } catch (error) {
    console.warn('Failed to close SQLite during reset:', error);
  }

  db = null;
  sqlite3Module = null;
  initPromise = null;
}

const DB_STORAGE_KEY = 'sqlite_db';
const DB_FILENAME = '/flowagent.sqlite3';
const ACTIVE_CONVERSATION_KEY = 'flowagent_active_conversation_id';
const DEFAULT_CONVERSATION_TITLE = 'New Conversation';
const LEGACY_WELCOME_MESSAGE =
  'Hello! I am your FlowAgent. SQLite is now connected for local storage and RAG. How can I assist you today?';

function createEmptyKnowledgeSearchMetrics(): KnowledgeDocumentSearchMetrics {
  return {
    cacheHit: false,
    expandedQueryCount: 0,
    subqueryCount: 0,
    primaryCandidateCount: 0,
    correctiveQueryCount: 0,
    correctiveCandidateCount: 0,
    lexicalDurationMs: 0,
    vectorDurationMs: 0,
    graphDurationMs: 0,
    rerankDurationMs: 0,
    correctiveDurationMs: 0,
    totalDurationMs: 0,
  };
}

const DEFAULT_ASSISTANTS: AssistantSeed[] = [
  {
    id: 'assistant_flowagent_core',
    name: 'FlowAgent Core',
    description: 'Balanced general-purpose agent for research, planning, and implementation.',
    systemPrompt:
      'You are FlowAgent Core. Be pragmatic, structured, and concise. Use tools when they improve the answer. When collaborating with other agents, provide a direct answer first and then the rationale.',
    accentColor: 'from-blue-500/20 to-violet-500/20',
    isDefault: true,
  },
  {
    id: 'assistant_research_scout',
    name: 'Research Scout',
    description: 'Focuses on background research, evidence collection, and concise synthesis.',
    systemPrompt:
      'You are Research Scout. Prioritize evidence, context, edge cases, and source quality. Summaries should stay tight and actionable.',
    accentColor: 'from-cyan-500/20 to-blue-500/20',
  },
  {
    id: 'assistant_build_operator',
    name: 'Build Operator',
    description: 'Turns requirements into implementation plans and production-minded code.',
    systemPrompt:
      'You are Build Operator. Think like a senior engineer. Prefer reliable, testable, incremental implementation steps and call out tradeoffs early.',
    accentColor: 'from-emerald-500/20 to-teal-500/20',
  },
  {
    id: 'assistant_quality_reviewer',
    name: 'Quality Reviewer',
    description: 'Reviews ideas for failure modes, regressions, and observability gaps.',
    systemPrompt:
      'You are Quality Reviewer. Focus on correctness, regressions, performance, edge cases, and how to verify the result with minimal risk.',
    accentColor: 'from-amber-500/20 to-orange-500/20',
  },
];

const DEFAULT_SNIPPETS: PromptSeed[] = [
  {
    id: 'snippet_breakdown',
    title: '需求拆解',
    category: 'Planning',
    content: '请先把这个需求拆成可交付的小步骤，并标出风险点、依赖项和验收标准。',
  },
  {
    id: 'snippet_review',
    title: '代码审查',
    category: 'Engineering',
    content: '请用 code review 的方式检查这个实现，优先指出 bug、回归风险和缺失的测试。',
  },
  {
    id: 'snippet_doc',
    title: '生成技术文档',
    category: 'Documentation',
    content: '请把当前实现整理成一份技术文档，包含架构、数据流、关键文件和后续待办。',
  },
];

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `${prefix}_${uuid ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
}

function parseTools(raw: unknown): StoredToolRun[] | undefined {
  if (typeof raw !== 'string' || !raw.trim()) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StoredToolRun[]) : undefined;
  } catch (error) {
    console.warn('Failed to parse tool metadata:', error);
    return undefined;
  }
}

function toConversationSummary(row: {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  last_message_at: string;
  preview: string | null;
  lane_count: number;
}): ConversationSummary {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastMessageAt: row.last_message_at,
    preview: row.preview ?? '',
    laneCount: Number(row.lane_count) || 0,
  };
}

function toAssistantProfile(row: {
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
}): AssistantProfile {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    systemPrompt: row.system_prompt,
    providerId: row.provider_id ?? undefined,
    model: row.model ?? undefined,
    accentColor: row.accent_color,
    isDefault: toBoolean(row.is_default),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toPromptSnippet(row: {
  id: string;
  title: string;
  content: string;
  category: string;
  created_at: string;
  updated_at: string;
}): PromptSnippet {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    category: row.category,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toGlobalMemoryDocument(row: {
  id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}): GlobalMemoryDocument {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toAgentLane(row: {
  id: string;
  conversation_id: string;
  assistant_id: string;
  name: string;
  description: string;
  system_prompt: string;
  provider_id: string | null;
  model: string | null;
  accent_color: string;
  position: number;
  created_at: string;
  updated_at: string;
}): AgentLane {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    assistantId: row.assistant_id,
    name: row.name,
    description: row.description,
    systemPrompt: row.system_prompt,
    providerId: row.provider_id ?? undefined,
    model: row.model ?? undefined,
    accentColor: row.accent_color,
    position: Number(row.position) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toChatMessage(row: {
  id: string;
  conversation_id: string;
  lane_id: string;
  role: ChatMessage['role'];
  author_name: string;
  content: string;
  tools_json: string | null;
  created_at: string;
}): ChatMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    laneId: row.lane_id,
    role: row.role,
    authorName: row.author_name,
    content: row.content,
    createdAt: row.created_at,
    tools: parseTools(row.tools_json),
  };
}

function getAssistantRow(database: Database, assistantId: string) {
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
    database.exec(
      `
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
        WHERE id = ?
        LIMIT 1
      `,
      [assistantId],
    ),
  );

  return rows[0] ? toAssistantProfile(rows[0]!) : null;
}

function getDefaultAssistant(database: Database): AssistantProfile {
  const explicitDefault = mapRows<{
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
    database.exec(
      `
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
        WHERE is_default = 1
        ORDER BY created_at ASC
        LIMIT 1
      `,
    ),
  )[0];

  if (explicitDefault) {
    return toAssistantProfile(explicitDefault);
  }

  const firstAssistant = mapRows<{
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
    database.exec(
      `
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
        ORDER BY created_at ASC
        LIMIT 1
      `,
    ),
  )[0];

  if (!firstAssistant) {
    throw new Error('No assistant profiles are available.');
  }

  return toAssistantProfile(firstAssistant);
}

function createLaneFromAssistant(
  database: Database,
  conversationId: string,
  assistant: AssistantProfile,
  position: number,
): AgentLane {
  const timestamp = nowIso();
  const laneId = createId('lane');
  database.run(
    `
      INSERT INTO agent_lanes (
        id,
        conversation_id,
        assistant_id,
        name,
        description,
        system_prompt,
        provider_id,
        model,
        accent_color,
        position,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      laneId,
      conversationId,
      assistant.id,
      assistant.name,
      assistant.description,
      assistant.systemPrompt,
      assistant.providerId ?? null,
      assistant.model ?? null,
      assistant.accentColor,
      position,
      timestamp,
      timestamp,
    ],
  );

  return {
    id: laneId,
    conversationId,
    assistantId: assistant.id,
    name: assistant.name,
    description: assistant.description,
    systemPrompt: assistant.systemPrompt,
    providerId: assistant.providerId,
    model: assistant.model,
    accentColor: assistant.accentColor,
    position,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function buildLaneWelcomeMessage(lane: AgentLane): ChatMessageInput {
  return {
    conversationId: lane.conversationId,
    laneId: lane.id,
    role: 'assistant',
    authorName: lane.name,
    content: `I’m ${lane.name}. ${lane.description} Send a task and I’ll work through it with the tools available in this workspace.`,
  };
}

async function seedAssistants(database: Database) {
  const count = Number(getScalar(database, 'SELECT COUNT(*) FROM assistants') ?? 0);
  if (count > 0) {
    return;
  }

  const timestamp = nowIso();
  DEFAULT_ASSISTANTS.forEach((assistant) => {
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
        assistant.id,
        assistant.name,
        assistant.description,
        assistant.systemPrompt,
        assistant.providerId ?? null,
        assistant.model ?? null,
        assistant.accentColor,
        assistant.isDefault ? 1 : 0,
        timestamp,
        timestamp,
      ],
    );
  });
}

async function seedPromptSnippets(database: Database) {
  const count = Number(getScalar(database, 'SELECT COUNT(*) FROM prompt_snippets') ?? 0);
  if (count > 0) {
    return;
  }

  const timestamp = nowIso();
  DEFAULT_SNIPPETS.forEach((snippet) => {
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
      [snippet.id, snippet.title, snippet.content, snippet.category, timestamp, timestamp],
    );
  });
}

async function seedInitialConversation(database: Database) {
  const count = Number(getScalar(database, 'SELECT COUNT(*) FROM conversations') ?? 0);
  if (count > 0) {
    return;
  }

  const timestamp = nowIso();
  const conversationId = createId('conversation');
  database.run(
    `
      INSERT INTO conversations (id, title, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `,
    [conversationId, DEFAULT_CONVERSATION_TITLE, timestamp, timestamp],
  );

  const defaultAssistant = getDefaultAssistant(database);
  const lane = createLaneFromAssistant(database, conversationId, defaultAssistant, 0);

  const legacyMessages = mapRows<{
    id: string;
    role: string;
    content: string;
    timestamp: string;
  }>(
    database.exec(
      `
        SELECT id, role, content, timestamp
        FROM messages
        ORDER BY timestamp ASC
      `,
    ),
  );

  if (legacyMessages.length > 0) {
    legacyMessages.forEach((message) => {
      database.run(
        `
          INSERT INTO chat_messages (
            id,
            conversation_id,
            lane_id,
            role,
            author_name,
            content,
            tools_json,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          `legacy_${message.id}`,
          conversationId,
          lane.id,
          message.role === 'agent' ? 'assistant' : 'user',
          message.role === 'agent' ? lane.name : 'You',
          message.content,
          null,
          new Date(`${message.timestamp}Z`).toISOString(),
        ],
      );
    });
  } else {
    const welcome = buildLaneWelcomeMessage(lane);
    database.run(
      `
        INSERT INTO chat_messages (
          id,
          conversation_id,
          lane_id,
          role,
          author_name,
          content,
          tools_json,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        createId('message'),
        welcome.conversationId,
        welcome.laneId,
        welcome.role,
        welcome.authorName,
        LEGACY_WELCOME_MESSAGE,
        null,
        timestamp,
      ],
    );
  }

  await localforage.setItem(ACTIVE_CONVERSATION_KEY, conversationId);
}

async function ensureSchema(database: Database) {
  database.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      role TEXT,
      content TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      title TEXT,
      content TEXT
    );

    CREATE TABLE IF NOT EXISTS document_chunks (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS document_search_cache (
      cache_key TEXT PRIMARY KEY,
      query TEXT NOT NULL,
      results_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS knowledge_evidence_feedback (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      value TEXT NOT NULL,
      source_type TEXT,
      support_label TEXT,
      matched_terms_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(message_id, document_id)
    );

    CREATE TABLE IF NOT EXISTS document_metadata (
      document_id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL,
      source_uri TEXT,
      tags_json TEXT NOT NULL,
      synced_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS document_graph_nodes (
      document_id TEXT NOT NULL,
      normalized_entity TEXT NOT NULL,
      entity TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      weight REAL NOT NULL,
      PRIMARY KEY (document_id, normalized_entity, entity_type)
    );

    CREATE TABLE IF NOT EXISTS document_graph_edges (
      document_id TEXT NOT NULL,
      source_entity TEXT NOT NULL,
      target_entity TEXT NOT NULL,
      relation TEXT NOT NULL,
      weight REAL NOT NULL,
      PRIMARY KEY (document_id, source_entity, target_entity, relation)
    );

    CREATE TABLE IF NOT EXISTS document_chunk_embeddings (
      chunk_id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      model TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      embedding_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS global_memory_documents (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS assistants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      system_prompt TEXT NOT NULL,
      provider_id TEXT,
      model TEXT,
      accent_color TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS prompt_snippets (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      category TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_lanes (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      assistant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      system_prompt TEXT NOT NULL,
      provider_id TEXT,
      model TEXT,
      accent_color TEXT NOT NULL,
      position INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      lane_id TEXT NOT NULL,
      role TEXT NOT NULL,
      author_name TEXT NOT NULL,
      content TEXT NOT NULL,
      tools_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_lanes_conversation ON agent_lanes(conversation_id, position ASC);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON chat_messages(conversation_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_lane ON chat_messages(lane_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_memory_docs_updated ON global_memory_documents(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_document_chunks_document ON document_chunks(document_id, chunk_index ASC);
    CREATE INDEX IF NOT EXISTS idx_document_metadata_source ON document_metadata(source_type, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_knowledge_evidence_feedback_doc ON knowledge_evidence_feedback(document_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_document_graph_nodes_entity ON document_graph_nodes(normalized_entity, weight DESC);
    CREATE INDEX IF NOT EXISTS idx_document_graph_nodes_doc ON document_graph_nodes(document_id, weight DESC);
    CREATE INDEX IF NOT EXISTS idx_document_graph_edges_doc ON document_graph_edges(document_id, weight DESC);
    CREATE INDEX IF NOT EXISTS idx_document_chunk_embeddings_doc ON document_chunk_embeddings(document_id, updated_at DESC);
  `);

  createFts5Table(
    database,
    {
      tableName: 'document_chunks_fts',
      columns: ['chunk_id UNINDEXED', 'document_id UNINDEXED', 'title', 'content'],
    },
    {
      onError: (error) => {
        console.warn('FTS5 document index unavailable, falling back to LIKE search:', error);
      },
    },
  );

  await seedAssistants(database);
  await seedPromptSnippets(database);
  await seedInitialConversation(database);
  await ensureDocumentIndexes(database);
}

export function getDocumentFtsEnabled(database: Database): boolean {
  return hasFts5Table(database, 'document_chunks_fts');
}

function clearDocumentChunks(database: Database, documentId: string) {
  database.run('DELETE FROM document_chunks WHERE document_id = ?', [documentId]);
  if (getDocumentFtsEnabled(database)) {
    database.run('DELETE FROM document_chunks_fts WHERE document_id = ?', [documentId]);
  }
}

function clearDocumentGraph(database: Database, documentId: string) {
  database.run('DELETE FROM document_graph_nodes WHERE document_id = ?', [documentId]);
  database.run('DELETE FROM document_graph_edges WHERE document_id = ?', [documentId]);
}

export function clearDocumentSearchCache(database: Database) {
  database.run('DELETE FROM document_search_cache');
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

async function ensureDocumentIndexes(database: Database) {
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

function buildFtsMatchQuery(query: string): string {
  return buildSemanticCacheKey(query)
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .map((part) => `"${part}"*`)
    .join(' OR ');
}

function readDocumentSearchCache(database: Database, cacheKey: string): RetrievedDocumentResult[] | null {
  const row = mapRows<{ results_json: string }>(
    database.exec(
      `
        SELECT results_json
        FROM document_search_cache
        WHERE cache_key = ?
        LIMIT 1
      `,
      [cacheKey],
    ),
  )[0];

  if (!row) {
    return null;
  }

  try {
    return JSON.parse(row.results_json) as RetrievedDocumentResult[];
  } catch (error) {
    console.warn(`Failed to parse document search cache for "${cacheKey}"; recomputing results:`, error);
    return null;
  }
}

function parseKnowledgeTags(raw: unknown, context: string) {
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

export function upsertKnowledgeEvidenceFeedbackInDatabase(
  database: Database,
  input: KnowledgeEvidenceFeedbackInput,
) {
  const timestamp = nowIso();
  database.run(
    `
      INSERT INTO knowledge_evidence_feedback (
        id,
        message_id,
        document_id,
        value,
        source_type,
        support_label,
        matched_terms_json,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(message_id, document_id) DO UPDATE SET
        value = excluded.value,
        source_type = excluded.source_type,
        support_label = excluded.support_label,
        matched_terms_json = excluded.matched_terms_json,
        updated_at = excluded.updated_at
    `,
    [
      createId('evidence_feedback'),
      input.messageId,
      input.documentId,
      input.value,
      input.sourceType ?? null,
      input.supportLabel ?? null,
      JSON.stringify(input.matchedTerms ?? []),
      timestamp,
      timestamp,
    ],
  );
}

export async function recordKnowledgeEvidenceFeedback(input: KnowledgeEvidenceFeedbackInput) {
  const database = await initDB();
  upsertKnowledgeEvidenceFeedbackInDatabase(database, input);
  await saveDB();
}

function getDocumentMetadataRecord(database: Database, documentId: string): KnowledgeDocumentRecord | null {
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

function mergeSearchResultWithMetadata(
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

function matchesKnowledgeDocumentFilters(
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

function readDocumentSourceTypeMap(database: Database) {
  return new Map(
    mapRows<{ document_id: string; source_type: KnowledgeDocumentSourceType | null }>(
      database.exec('SELECT document_id, source_type FROM document_metadata'),
    ).map((row) => [row.document_id, row.source_type ?? 'user_upload']),
  );
}

function buildKnowledgeDocumentFilterSql(
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

function getSourceTypeWeight(sourceType: KnowledgeDocumentSourceType | undefined, options?: KnowledgeDocumentSearchOptions) {
  if (!sourceType) {
    return 1;
  }

  const weight = options?.searchWeights?.sourceTypeWeights?.[sourceType];
  return typeof weight === 'number' && Number.isFinite(weight) && weight >= 0 ? weight : 1;
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

async function getEmbeddingConfig() {
  const config = await getAgentConfig();
  return buildEmbeddingConfigFromDocuments(config.documents);
}

function deleteDocumentChunkEmbeddings(database: Database, documentId: string) {
  database.run('DELETE FROM document_chunk_embeddings WHERE document_id = ?', [documentId]);
}

async function syncDocumentChunkEmbeddings(
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

async function ensureDocumentEmbeddings(database: Database, embeddingConfig: EmbeddingProviderConfig) {
  const documentIds = mapRows<{ id: string }>(
    database.exec('SELECT id FROM documents ORDER BY rowid ASC'),
  ).map((row) => row.id);

  for (const documentId of documentIds) {
    await syncDocumentChunkEmbeddings(database, documentId, embeddingConfig);
  }
}

function writeDocumentSearchCache(
  database: Database,
  cacheKey: string,
  query: string,
  results: { id: string; title: string; content: string }[],
) {
  const timestamp = nowIso();
  database.run(
    `
      INSERT INTO document_search_cache (cache_key, query, results_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
        query = excluded.query,
        results_json = excluded.results_json,
        updated_at = excluded.updated_at
    `,
    [cacheKey, query, JSON.stringify(results), timestamp],
  );
}

export async function initDB(): Promise<Database> {
  if (db) {
    return db;
  }

  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    try {
      sqlite3Module = await initializeSqliteModule();

      const savedData = await localforage.getItem<Uint8Array>(DB_STORAGE_KEY);
      if (savedData) {
        try {
          sqlite3Module.capi.sqlite3_js_posix_create_file(DB_FILENAME, savedData);
          db = new Database(sqlite3Module, new sqlite3Module.oo1.DB(DB_FILENAME, 'w'));
        } catch (error) {
          console.warn('Failed to load saved database, recreating it:', error);
          await localforage.removeItem(DB_STORAGE_KEY);
          db = new Database(sqlite3Module, new sqlite3Module.oo1.DB(DB_FILENAME, 'c'));
        }
      } else {
        db = new Database(sqlite3Module, new sqlite3Module.oo1.DB(DB_FILENAME, 'c'));
      }

      await ensureSchema(db);
      await saveDB();
      return db;
    } catch (error) {
      console.error('Failed to initialize SQLite:', {
        error,
        environment:
          typeof window !== 'undefined' && typeof document !== 'undefined' ? 'browser' : 'node',
      });
      resetDatabaseConnectionState();
      throw error;
    }
  })();

  return initPromise;
}

export async function saveDB() {
  if (!db) {
    return;
  }

  const data = db.export();
  await localforage.setItem(DB_STORAGE_KEY, data);
}

export async function listConversations(): Promise<ConversationSummary[]> {
  const database = await initDB();
  const rows = mapRows<{
    id: string;
    title: string;
    created_at: string;
    updated_at: string;
    last_message_at: string;
    preview: string | null;
    lane_count: number;
  }>(
    database.exec(`
      SELECT
        c.id,
        c.title,
        c.created_at,
        c.updated_at,
        COALESCE(
          (SELECT MAX(created_at) FROM chat_messages WHERE conversation_id = c.id),
          c.updated_at
        ) AS last_message_at,
        (
          SELECT content
          FROM chat_messages
          WHERE conversation_id = c.id
          ORDER BY created_at DESC
          LIMIT 1
        ) AS preview,
        (
          SELECT COUNT(*)
          FROM agent_lanes
          WHERE conversation_id = c.id
        ) AS lane_count
      FROM conversations c
      ORDER BY last_message_at DESC, c.updated_at DESC
    `),
  );

  return rows.map(toConversationSummary);
}

export async function getConversationWorkspace(
  conversationId: string,
): Promise<ConversationWorkspace | null> {
  const database = await initDB();
  const conversationRow = mapRows<{
    id: string;
    title: string;
    created_at: string;
    updated_at: string;
    last_message_at: string;
    preview: string | null;
    lane_count: number;
  }>(
    database.exec(
      `
        SELECT
          c.id,
          c.title,
          c.created_at,
          c.updated_at,
          COALESCE(
            (SELECT MAX(created_at) FROM chat_messages WHERE conversation_id = c.id),
            c.updated_at
          ) AS last_message_at,
          (
            SELECT content
            FROM chat_messages
            WHERE conversation_id = c.id
            ORDER BY created_at DESC
            LIMIT 1
          ) AS preview,
          (
            SELECT COUNT(*)
            FROM agent_lanes
            WHERE conversation_id = c.id
          ) AS lane_count
        FROM conversations c
        WHERE c.id = ?
        LIMIT 1
      `,
      [conversationId],
    ),
  )[0];

  if (!conversationRow) {
    return null;
  }

  const lanes = mapRows<{
    id: string;
    conversation_id: string;
    assistant_id: string;
    name: string;
    description: string;
    system_prompt: string;
    provider_id: string | null;
    model: string | null;
    accent_color: string;
    position: number;
    created_at: string;
    updated_at: string;
  }>(
    database.exec(
      `
        SELECT
          id,
          conversation_id,
          assistant_id,
          name,
          description,
          system_prompt,
          provider_id,
          model,
          accent_color,
          position,
          created_at,
          updated_at
        FROM agent_lanes
        WHERE conversation_id = ?
        ORDER BY position ASC, created_at ASC
      `,
      [conversationId],
    ),
  ).map(toAgentLane);

  const messageRows = mapRows<{
    id: string;
    conversation_id: string;
    lane_id: string;
    role: ChatMessage['role'];
    author_name: string;
    content: string;
    tools_json: string | null;
    created_at: string;
  }>(
    database.exec(
      `
        SELECT
          id,
          conversation_id,
          lane_id,
          role,
          author_name,
          content,
          tools_json,
          created_at
        FROM chat_messages
        WHERE conversation_id = ?
        ORDER BY created_at ASC
      `,
      [conversationId],
    ),
  ).map(toChatMessage);

  const messagesByLane = lanes.reduce<Record<string, ChatMessage[]>>((acc, lane) => {
    acc[lane.id] = [];
    return acc;
  }, {});

  messageRows.forEach((message) => {
    if (!messagesByLane[message.laneId]) {
      messagesByLane[message.laneId] = [];
    }
    messagesByLane[message.laneId]!.push(message);
  });

  return {
    conversation: toConversationSummary(conversationRow),
    lanes,
    messagesByLane,
  };
}

export async function createConversation(options?: {
  title?: string;
  assistantIds?: string[];
}): Promise<ConversationWorkspace> {
  const database = await initDB();
  const conversationId = createId('conversation');
  const timestamp = nowIso();
  const title = options?.title?.trim() || DEFAULT_CONVERSATION_TITLE;
  const resolvedAssistantIds =
    options?.assistantIds?.filter(Boolean) && options.assistantIds.length > 0
      ? options.assistantIds
      : [getDefaultAssistant(database).id];

  await runDatabaseTransaction(database, () => {
    database.run(
      `
        INSERT INTO conversations (id, title, created_at, updated_at)
        VALUES (?, ?, ?, ?)
      `,
      [conversationId, title, timestamp, timestamp],
    );

    const lanes = resolvedAssistantIds.map((assistantId, index) => {
      const assistant = getAssistantRow(database, assistantId) ?? getDefaultAssistant(database);
      return createLaneFromAssistant(database, conversationId, assistant, index);
    });

    lanes.forEach((lane, index) => {
      if (index === 0) {
        const welcome = buildLaneWelcomeMessage(lane);
        database.run(
          `
            INSERT INTO chat_messages (
              id,
              conversation_id,
              lane_id,
              role,
              author_name,
              content,
              tools_json,
              created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            createId('message'),
            welcome.conversationId,
            welcome.laneId,
            welcome.role,
            welcome.authorName,
            welcome.content,
            null,
            timestamp,
          ],
        );
      }
    });
  });

  await saveDB();
  await setActiveConversationId(conversationId);

  const workspace = await getConversationWorkspace(conversationId);
  if (!workspace) {
    throw new Error('Failed to create conversation.');
  }

  return workspace;
}

export async function addLaneToConversation(
  conversationId: string,
  assistantId: string,
): Promise<ConversationWorkspace> {
  const database = await initDB();
  const assistant = getAssistantRow(database, assistantId);
  if (!assistant) {
    throw new Error('Assistant profile not found.');
  }

  const position = Number(
    getScalar(
      database,
      'SELECT COALESCE(MAX(position), -1) + 1 FROM agent_lanes WHERE conversation_id = ?',
      [conversationId],
    ) ?? 0,
  );

  const timestamp = nowIso();
  await runDatabaseTransaction(database, () => {
    const lane = createLaneFromAssistant(database, conversationId, assistant, position);
    const welcome = buildLaneWelcomeMessage(lane);
    database.run(
      `
        INSERT INTO chat_messages (
          id,
          conversation_id,
          lane_id,
          role,
          author_name,
          content,
          tools_json,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        createId('message'),
        welcome.conversationId,
        welcome.laneId,
        welcome.role,
        welcome.authorName,
        welcome.content,
        null,
        timestamp,
      ],
    );
    database.run('UPDATE conversations SET updated_at = ? WHERE id = ?', [timestamp, conversationId]);
  });

  await saveDB();
  const workspace = await getConversationWorkspace(conversationId);
  if (!workspace) {
    throw new Error('Failed to add lane.');
  }
  return workspace;
}

export async function addConversationMessages(messages: ChatMessageInput[]) {
  if (messages.length === 0) {
    return;
  }

  const database = await initDB();
  await runDatabaseTransaction(database, () => {
    messages.forEach((message) => {
      const createdAt = message.createdAt ?? nowIso();
      database.run(
        `
          INSERT INTO chat_messages (
            id,
            conversation_id,
            lane_id,
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
          message.conversationId,
          message.laneId,
          message.role,
          message.authorName,
          message.content,
          message.tools ? JSON.stringify(message.tools) : null,
          createdAt,
        ],
      );
      database.run('UPDATE conversations SET updated_at = ? WHERE id = ?', [
        createdAt,
        message.conversationId,
      ]);
    });
  });

  await saveDB();
}

export async function updateConversationTitle(conversationId: string, title: string) {
  const database = await initDB();
  const normalizedTitle = title.trim() || DEFAULT_CONVERSATION_TITLE;
  const timestamp = nowIso();
  database.run('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?', [
    normalizedTitle,
    timestamp,
    conversationId,
  ]);
  await saveDB();
}

export async function getActiveConversationId(): Promise<string | null> {
  const stored = await localforage.getItem<string>(ACTIVE_CONVERSATION_KEY);
  if (stored) {
    return stored;
  }

  const conversations = await listConversations();
  return conversations[0]?.id ?? null;
}

export async function setActiveConversationId(conversationId: string) {
  await localforage.setItem(ACTIVE_CONVERSATION_KEY, conversationId);
}

export async function listAssistants(): Promise<AssistantProfile[]> {
  const database = await initDB();
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

export async function saveAssistant(
  draft: Omit<AssistantProfile, 'createdAt' | 'updatedAt' | 'isDefault'> & { isDefault?: boolean },
): Promise<AssistantProfile> {
  const database = await initDB();
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

  await saveDB();
  const assistant = getAssistantRow(database, id);
  if (!assistant) {
    throw new Error('Failed to save assistant.');
  }
  return assistant;
}

export async function listPromptSnippets(): Promise<PromptSnippet[]> {
  const database = await initDB();
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

export async function savePromptSnippet(
  draft: Omit<PromptSnippet, 'createdAt' | 'updatedAt'>,
): Promise<PromptSnippet> {
  const database = await initDB();
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

  await saveDB();
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

export async function getDataStats(): Promise<DataStats> {
  const database = await initDB();
  return {
    conversations: Number(getScalar(database, 'SELECT COUNT(*) FROM conversations') ?? 0),
    lanes: Number(getScalar(database, 'SELECT COUNT(*) FROM agent_lanes') ?? 0),
    messages: Number(getScalar(database, 'SELECT COUNT(*) FROM chat_messages') ?? 0),
    documents: Number(getScalar(database, 'SELECT COUNT(*) FROM documents') ?? 0),
    memoryDocuments: Number(getScalar(database, 'SELECT COUNT(*) FROM global_memory_documents') ?? 0),
    assistants: Number(getScalar(database, 'SELECT COUNT(*) FROM assistants') ?? 0),
    snippets: Number(getScalar(database, 'SELECT COUNT(*) FROM prompt_snippets') ?? 0),
  };
}

export async function listGlobalMemoryDocuments(): Promise<GlobalMemoryDocument[]> {
  const database = await initDB();
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

export async function saveGlobalMemoryDocument(draft: {
  id?: string;
  title: string;
  content: string;
}) {
  const database = await initDB();
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

  await saveDB();

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

export async function deleteGlobalMemoryDocument(id: string) {
  const database = await initDB();
  database.run('DELETE FROM global_memory_documents WHERE id = ?', [id]);
  await saveDB();
}

export async function exportWorkspaceData(options?: { minimal?: boolean }) {
  const includeDocuments = !options?.minimal;
  const [conversations, assistants, snippets, documents, globalMemoryDocuments] = await Promise.all([
    listConversations(),
    listAssistants(),
    listPromptSnippets(),
    includeDocuments ? getDocuments() : Promise.resolve([]),
    listGlobalMemoryDocuments(),
  ]);

  const workspaces = await Promise.all(
    conversations.map((conversation) => getConversationWorkspace(conversation.id)),
  );

  return {
    exportedAt: nowIso(),
    conversations,
    assistants,
    snippets,
    documents,
    globalMemoryDocuments,
    workspaces: workspaces.filter(Boolean),
    minimal: Boolean(options?.minimal),
  };
}

export async function importWorkspaceData(payload: {
  conversations?: ConversationSummary[];
  assistants?: AssistantProfile[];
  snippets?: PromptSnippet[];
  documents?: { id: string; title: string; content: string }[];
  globalMemoryDocuments?: GlobalMemoryDocument[];
  workspaces?: ConversationWorkspace[];
}) {
  const database = await initDB();
  const workspaces = Array.isArray(payload.workspaces) ? payload.workspaces.filter(Boolean) : [];
  const assistants = Array.isArray(payload.assistants) ? payload.assistants : [];
  const snippets = Array.isArray(payload.snippets) ? payload.snippets : [];
  const documents = Array.isArray(payload.documents) ? payload.documents : [];
  const globalMemoryDocuments = Array.isArray(payload.globalMemoryDocuments)
    ? payload.globalMemoryDocuments
    : [];
  let shouldSeedConversation = false;

  await runDatabaseTransaction(database, async () => {
    [
      'messages',
      'chat_messages',
      'agent_lanes',
      'conversations',
      'assistants',
      'prompt_snippets',
      'documents',
      'document_chunks',
      'document_chunk_embeddings',
      'document_search_cache',
      'document_metadata',
      'global_memory_documents',
    ].forEach((table) => {
      database.run(`DELETE FROM ${table}`);
    });
    if (getDocumentFtsEnabled(database)) {
      database.run('DELETE FROM document_chunks_fts');
    }

    assistants.forEach((assistant) => {
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
          assistant.id,
          assistant.name,
          assistant.description,
          assistant.systemPrompt,
          assistant.providerId ?? null,
          assistant.model ?? null,
          assistant.accentColor,
          assistant.isDefault ? 1 : 0,
          assistant.createdAt,
          assistant.updatedAt,
        ],
      );
    });

    snippets.forEach((snippet) => {
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
        [
          snippet.id,
          snippet.title,
          snippet.content,
          snippet.category,
          snippet.createdAt,
          snippet.updatedAt,
        ],
      );
    });

    documents.forEach((document) => {
      database.run('INSERT INTO documents (id, title, content) VALUES (?, ?, ?)', [
        document.id,
        document.title,
        document.content,
      ]);
      indexDocumentChunks(database, document);
    });

    globalMemoryDocuments.forEach((document) => {
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
        [document.id, document.title, document.content, document.createdAt, document.updatedAt],
      );
    });

    workspaces.forEach((workspace) => {
      database.run(
        `
          INSERT INTO conversations (id, title, created_at, updated_at)
          VALUES (?, ?, ?, ?)
        `,
        [
          workspace.conversation.id,
          workspace.conversation.title,
          workspace.conversation.createdAt,
          workspace.conversation.updatedAt,
        ],
      );

      workspace.lanes.forEach((lane) => {
        database.run(
          `
            INSERT INTO agent_lanes (
              id,
              conversation_id,
              assistant_id,
              name,
              description,
              system_prompt,
              provider_id,
              model,
              accent_color,
              position,
              created_at,
              updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            lane.id,
            lane.conversationId,
            lane.assistantId,
            lane.name,
            lane.description,
            lane.systemPrompt,
            lane.providerId ?? null,
            lane.model ?? null,
            lane.accentColor,
            lane.position,
            lane.createdAt,
            lane.updatedAt,
          ],
        );
      });

      Object.values(workspace.messagesByLane)
        .flat()
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .forEach((message) => {
          database.run(
            `
              INSERT INTO chat_messages (
                id,
                conversation_id,
                lane_id,
                role,
                author_name,
                content,
                tools_json,
                created_at
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
              message.id,
              message.conversationId,
              message.laneId,
              message.role,
              message.authorName,
              message.content,
              message.tools ? JSON.stringify(message.tools) : null,
              message.createdAt,
            ],
          );
        });
    });

    if (assistants.length === 0) {
      await seedAssistants(database);
    }

    if (snippets.length === 0) {
      await seedPromptSnippets(database);
    }

    const conversationCount = Number(getScalar(database, 'SELECT COUNT(*) FROM conversations') ?? 0);
    shouldSeedConversation = conversationCount === 0;
  });

  if (shouldSeedConversation) {
    await seedInitialConversation(database);
  }

  await saveDB();

  const preferredConversationId =
    workspaces[0]?.conversation.id ??
    (payload.conversations?.[0] ? payload.conversations[0].id : null);

  if (preferredConversationId) {
    await localforage.setItem(ACTIVE_CONVERSATION_KEY, preferredConversationId);
  }
}

export async function addMessage(id: string, role: string, content: string) {
  const database = await initDB();
  database.run('INSERT INTO messages (id, role, content) VALUES (?, ?, ?)', [id, role, content]);
  await saveDB();
}

export async function getMessages() {
  const database = await initDB();
  try {
    const res = database.exec(
      'SELECT id, role, content, timestamp FROM messages ORDER BY timestamp ASC',
    );
    if (res.length === 0) {
      return [];
    }

    return res[0]!.values.map((row) => ({
      id: String(row[0]),
      role: String(row[1]),
      content: String(row[2]),
      timestamp: new Date(`${String(row[3])}Z`),
    }));
  } catch {
    return [];
  }
}

export async function clearMessages() {
  const database = await initDB();
  database.run('DELETE FROM messages');
  await saveDB();
}

export async function upsertKnowledgeDocument(
  record: Pick<KnowledgeDocumentRecord, 'id' | 'title' | 'content'> &
    Partial<Pick<KnowledgeDocumentRecord, 'sourceType' | 'sourceUri' | 'tags' | 'syncedAt'>>,
  options?: { skipEmbeddings?: boolean },
) {
  const database = await initDB();
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
  if (!options?.skipEmbeddings) {
    const embeddingConfig = await getEmbeddingConfig();
    if (embeddingConfig) {
      try {
        await syncDocumentChunkEmbeddings(database, record.id, embeddingConfig);
      } catch (error) {
        console.warn('Embedding sync failed, keeping lexical index only:', error);
      }
    } else {
      deleteDocumentChunkEmbeddings(database, record.id);
    }
  }
  clearDocumentSearchCache(database);
  await saveDB();
  return true;
}

export async function syncKnowledgeDocuments(
  records: Array<
    Pick<KnowledgeDocumentRecord, 'id' | 'title' | 'content'> &
      Partial<Pick<KnowledgeDocumentRecord, 'sourceType' | 'sourceUri' | 'tags' | 'syncedAt'>>
  >,
  options?: { skipEmbeddings?: boolean },
) {
  let changed = 0;
  for (const record of records) {
    if (await upsertKnowledgeDocument(record, options)) {
      changed += 1;
    }
  }
  return changed;
}

export async function addDocument(
  id: string,
  title: string,
  content: string,
  options?: Partial<Pick<KnowledgeDocumentRecord, 'sourceType' | 'sourceUri' | 'tags' | 'syncedAt'>>,
) {
  await upsertKnowledgeDocument({
    id,
    title,
    content,
    ...options,
  });
}

export async function getDocumentById(id: string) {
  const database = await initDB();
  return getDocumentMetadataRecord(database, id);
}

export async function getDocuments() {
  const database = await initDB();
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

export async function deleteDocument(id: string) {
  const database = await initDB();
  clearDocumentChunks(database, id);
  clearDocumentGraph(database, id);
  deleteDocumentChunkEmbeddings(database, id);
  database.run('DELETE FROM document_metadata WHERE document_id = ?', [id]);
  database.run('DELETE FROM documents WHERE id = ?', [id]);
  clearDocumentSearchCache(database);
  await saveDB();
}

async function readVectorCandidates(
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

function readGraphCandidates(
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

function mergeDocumentSearchCandidate(
  seen: Map<string, DocumentSearchCandidate>,
  candidate: DocumentSearchCandidate,
) {
  const existing = seen.get(candidate.id);
  if (!existing) {
    seen.set(candidate.id, {
      ...candidate,
      graphHints: [...(candidate.graphHints ?? [])],
      graphExpansionHints: [...(candidate.graphExpansionHints ?? [])],
      graphPaths: [...(candidate.graphPaths ?? [])],
    });
    return;
  }

  existing.lexicalScore = Math.min(
    existing.lexicalScore ?? Number.POSITIVE_INFINITY,
    candidate.lexicalScore ?? Number.POSITIVE_INFINITY,
  );
  if (!Number.isFinite(existing.lexicalScore)) {
    delete existing.lexicalScore;
  }

  existing.vectorScore = Math.max(existing.vectorScore ?? 0, candidate.vectorScore ?? 0) || undefined;
  existing.graphScore = Math.max(existing.graphScore ?? 0, candidate.graphScore ?? 0) || undefined;
  existing.sourceType = existing.sourceType ?? candidate.sourceType;

  if (!existing.content.trim() && candidate.content.trim()) {
    existing.content = candidate.content;
  }

  const graphHints = new Set([...(existing.graphHints ?? []), ...(candidate.graphHints ?? [])]);
  existing.graphHints = [...graphHints].slice(0, 6);
  const graphExpansionHints = new Set([
    ...(existing.graphExpansionHints ?? []),
    ...(candidate.graphExpansionHints ?? []),
  ]);
  existing.graphExpansionHints = [...graphExpansionHints].slice(0, 6);
  const graphPaths = new Set([...(existing.graphPaths ?? []), ...(candidate.graphPaths ?? [])]);
  existing.graphPaths = [...graphPaths].slice(0, 4);
}

async function collectDocumentCandidates(
  database: Database,
  retrievalQuery: string,
  subqueries: string[],
  options?: KnowledgeDocumentSearchOptions,
): Promise<{ candidates: DocumentSearchCandidate[]; metrics: CandidateCollectionMetrics }> {
  const seen = new Map<string, DocumentSearchCandidate>();
  const ftsEnabled = getDocumentFtsEnabled(database);
  const filter = buildKnowledgeDocumentFilterSql(options);
  const sourceTypeByDocumentId = readDocumentSourceTypeMap(database);
  let lexicalDurationMs = 0;
  let vectorDurationMs = 0;
  let graphDurationMs = 0;

  for (const subquery of subqueries) {
    const lexicalStartedAt = Date.now();
    const matchQuery = buildFtsMatchQuery(subquery);
    if (ftsEnabled && matchQuery) {
      const rows = mapRows<DocumentSearchRow>(
        database.exec(
          `
            SELECT
              d.id,
              d.title,
              c.content,
              bm25(document_chunks_fts, 1.0, 0.6) AS score
            FROM document_chunks_fts
            JOIN document_chunks c ON c.id = document_chunks_fts.chunk_id
            JOIN documents d ON d.id = c.document_id
            ${filter.joinSql}
            WHERE document_chunks_fts MATCH ?
            ${filter.whereSql}
            ORDER BY score ASC
            LIMIT 8
          `,
          [matchQuery, ...filter.params],
        ),
      );

      rows.forEach((row) => {
        mergeDocumentSearchCandidate(seen, {
          id: row.id,
          title: row.title,
          content: row.content,
          lexicalScore: row.score,
          sourceType: sourceTypeByDocumentId.get(row.id),
        });
      });
      lexicalDurationMs += Date.now() - lexicalStartedAt;
      continue;
    }

    const terms = buildSemanticCacheKey(subquery)
      .split(/\s+/)
      .filter((word) => word.length > 0);
    if (terms.length === 0) {
      lexicalDurationMs += Date.now() - lexicalStartedAt;
      continue;
    }

    const conditions = terms.map(() => '(title LIKE ? OR content LIKE ?)').join(' OR ');
    const params = terms.flatMap((word) => [`%${word}%`, `%${word}%`]);
    const rows = mapRows<{ id: string; title: string; content: string }>(
      database.exec(
        `
          SELECT d.id, d.title, d.content
          FROM documents d
          ${filter.joinSql}
          WHERE (${conditions})
          ${filter.whereSql}
          LIMIT 8
        `,
        [...params, ...filter.params],
      ),
    );

    rows.forEach((row, index) => {
      mergeDocumentSearchCandidate(seen, {
        id: row.id,
        title: row.title,
        content: row.content,
        lexicalScore: index + 1,
        sourceType: sourceTypeByDocumentId.get(row.id),
      });
    });
    lexicalDurationMs += Date.now() - lexicalStartedAt;
  }

  if (options?.embeddingConfig) {
    const vectorStartedAt = Date.now();
    try {
      await ensureDocumentEmbeddings(database, options.embeddingConfig);
      const embeddingResponse = await createEmbeddings(retrievalQuery, options.embeddingConfig);
      const queryEmbedding = embeddingResponse.data[0]?.embedding;
      if (Array.isArray(queryEmbedding) && queryEmbedding.length > 0) {
        const vectorCandidates = await readVectorCandidates(database, queryEmbedding, options);
        vectorCandidates.forEach((candidate) =>
          mergeDocumentSearchCandidate(seen, {
            ...candidate,
            sourceType: sourceTypeByDocumentId.get(candidate.id),
          }),
        );
      }
    } catch (error) {
      console.warn('Vector search failed, falling back to lexical results:', error);
    } finally {
      vectorDurationMs += Date.now() - vectorStartedAt;
    }
  }

  const graphStartedAt = Date.now();
  const graphCandidates = readGraphCandidates(database, retrievalQuery, options);
  graphCandidates.forEach((candidate) =>
    mergeDocumentSearchCandidate(seen, {
      ...candidate,
      sourceType: sourceTypeByDocumentId.get(candidate.id),
    }),
  );
  graphDurationMs += Date.now() - graphStartedAt;

  return {
    candidates: [...seen.values()],
    metrics: {
      lexicalDurationMs,
      vectorDurationMs,
      graphDurationMs,
    },
  };
}

function shapeRetrievedDocumentResults(
  query: string,
  candidates: DocumentSearchCandidate[],
  options?: KnowledgeDocumentSearchOptions,
  retrievalStages?: Map<string, 'primary' | 'corrective' | 'hybrid'>,
): RetrievedDocumentResult[] {
  const graphWeight = options?.searchWeights?.graphWeight ?? 0.12;

  return rerankHybridDocuments(hybridScoreDocuments(candidates, options?.searchWeights), query)
    .map((row) => ({
      ...row,
      hybridScore: (row.hybridScore + (row.graphScore ?? 0) * graphWeight) * getSourceTypeWeight(row.sourceType, options),
    }))
    .sort((left, right) => right.hybridScore - left.hybridScore)
    .slice(0, options?.maxResults ?? 5)
    .map((row) => {
      const compressedContent = compressRetrievedContext(query, row.content);
      const support = scoreRetrievedContextSupport(query, row.title, compressedContent);
      return {
        id: row.id,
        title: row.title,
        content: compressedContent,
        graphHints: row.graphHints ?? [],
        graphExpansionHints: row.graphExpansionHints ?? [],
        graphPaths: row.graphPaths ?? [],
        supportScore: support.score,
        supportLabel: support.label,
        matchedTerms: support.matchedTerms,
        retrievalStage: retrievalStages?.get(row.id) ?? 'primary',
      };
    });
}

export async function searchDocumentsInDatabase(
  database: Database,
  query: string,
  options?: KnowledgeDocumentSearchOptions,
): Promise<RetrievedDocumentResult[]> {
  return (await searchDocumentsInDatabaseWithMetrics(database, query, options)).results;
}

async function searchDocumentsInDatabaseWithMetrics(
  database: Database,
  query: string,
  options?: KnowledgeDocumentSearchOptions,
): Promise<{ results: RetrievedDocumentResult[]; metrics: KnowledgeDocumentSearchMetrics }> {
  const totalStartedAt = Date.now();
  const metrics = createEmptyKnowledgeSearchMetrics();
  try {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      metrics.totalDurationMs = Date.now() - totalStartedAt;
      return { results: [], metrics };
    }

    const expandedQueries = expandKnowledgeSearchQueries(normalizedQuery);
    metrics.expandedQueryCount = expandedQueries.length;
    const baseCacheKey = expandedQueries.join('::');
    if (!baseCacheKey) {
      metrics.totalDurationMs = Date.now() - totalStartedAt;
      return { results: [], metrics };
    }
    const cacheKey = options?.embeddingConfig
      ? `${baseCacheKey}::hybrid::${options.embeddingConfig.model}`
      : `${baseCacheKey}::lexical`;
    const scopedCacheKey = [
      cacheKey,
      options?.sourceTypes?.length ? `types=${options.sourceTypes.join(',')}` : '',
      options?.sourceUriPrefixes?.length ? `uris=${options.sourceUriPrefixes.join(',')}` : '',
      options?.searchWeights
        ? `weights=${options.searchWeights.lexicalWeight ?? ''},${options.searchWeights.vectorWeight ?? ''},${options.searchWeights.graphWeight ?? ''},sources=${Object.entries(options.searchWeights.sourceTypeWeights ?? {})
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([sourceType, weight]) => `${sourceType}:${weight}`)
            .join('|')}`
        : '',
    ]
      .filter(Boolean)
      .join('::');

    const cached = readDocumentSearchCache(database, scopedCacheKey);
    if (cached) {
      metrics.cacheHit = true;
      metrics.totalDurationMs = Date.now() - totalStartedAt;
      return { results: cached, metrics };
    }

    const subqueries = expandedQueries.length > 0 ? expandedQueries : decomposeTaskQuery(normalizedQuery);
    metrics.subqueryCount = subqueries.length;
    const primaryCollection = await collectDocumentCandidates(database, normalizedQuery, subqueries, options);
    const primaryCandidates = primaryCollection.candidates;
    metrics.primaryCandidateCount = primaryCandidates.length;
    metrics.lexicalDurationMs += primaryCollection.metrics.lexicalDurationMs;
    metrics.vectorDurationMs += primaryCollection.metrics.vectorDurationMs;
    metrics.graphDurationMs += primaryCollection.metrics.graphDurationMs;
    const retrievalStages = new Map<string, 'primary' | 'corrective' | 'hybrid'>(
      primaryCandidates.map((candidate) => [candidate.id, 'primary']),
    );

    const rerankStartedAt = Date.now();
    const primaryResults = shapeRetrievedDocumentResults(normalizedQuery, primaryCandidates, options, retrievalStages);
    metrics.rerankDurationMs += Date.now() - rerankStartedAt;
    const correctivePlan = planCorrectiveKnowledgeQueries(normalizedQuery, primaryResults, options);
    metrics.correctiveQueryCount = correctivePlan.queries.length;

    let finalResults = primaryResults;
    if (correctivePlan.queries.length > 0) {
      const correctiveStartedAt = Date.now();
      const correctiveCollection = await collectDocumentCandidates(
        database,
        correctivePlan.queries.join(' '),
        correctivePlan.queries,
        options,
      );
      const correctiveCandidates = correctiveCollection.candidates;
      metrics.correctiveCandidateCount = correctiveCandidates.length;
      metrics.lexicalDurationMs += correctiveCollection.metrics.lexicalDurationMs;
      metrics.vectorDurationMs += correctiveCollection.metrics.vectorDurationMs;
      metrics.graphDurationMs += correctiveCollection.metrics.graphDurationMs;

      if (correctiveCandidates.length > 0) {
        const merged = new Map<string, DocumentSearchCandidate>(
          primaryCandidates.map((candidate) => [candidate.id, { ...candidate, graphHints: [...(candidate.graphHints ?? [])] }]),
        );

        correctiveCandidates.forEach((candidate) => {
          const existing = merged.get(candidate.id);
          if (existing) {
            mergeDocumentSearchCandidate(merged, candidate);
            retrievalStages.set(candidate.id, 'hybrid');
            return;
          }

          merged.set(candidate.id, {
            ...candidate,
            graphHints: [...(candidate.graphHints ?? [])],
          });
          retrievalStages.set(candidate.id, 'corrective');
          });

        const correctiveRerankStartedAt = Date.now();
        finalResults = shapeRetrievedDocumentResults(
          normalizedQuery,
          [...merged.values()],
          options,
          retrievalStages,
        );
        metrics.rerankDurationMs += Date.now() - correctiveRerankStartedAt;
      }
      metrics.correctiveDurationMs += Date.now() - correctiveStartedAt;
    }

    writeDocumentSearchCache(database, scopedCacheKey, normalizedQuery, finalResults);
    metrics.totalDurationMs = Date.now() - totalStartedAt;
    return { results: finalResults, metrics };
  } catch (error) {
    console.error('Search error:', error);
    metrics.totalDurationMs = Date.now() - totalStartedAt;
    return { results: [], metrics };
  }
}

export async function searchDocuments(query: string) {
  const database = await initDB();
  const config = await getAgentConfig();
  const results = await searchDocumentsInDatabase(database, query, {
    embeddingConfig: buildEmbeddingConfigFromDocuments(config.documents),
    maxResults: config.documents.maxSearchResults,
    searchWeights: config.search.weights,
  });
  await saveDB();
  return results;
}

export async function searchKnowledgeDocuments(
  query: string,
  options: Omit<KnowledgeDocumentSearchOptions, 'embeddingConfig'> = {},
): Promise<KnowledgeDocumentSearchResult[]> {
  return (await searchKnowledgeDocumentsWithMetrics(query, options)).results;
}

export async function searchKnowledgeDocumentsWithMetrics(
  query: string,
  options: Omit<KnowledgeDocumentSearchOptions, 'embeddingConfig'> = {},
): Promise<KnowledgeDocumentSearchResponse> {
  const database = await initDB();
  const config = await getAgentConfig();
  const response = await searchDocumentsInDatabaseWithMetrics(database, query, {
    ...options,
    embeddingConfig: buildEmbeddingConfigFromDocuments(config.documents),
    searchWeights: options.searchWeights ?? config.search.weights,
  });

  const results = response.results
    .map((row) =>
      mergeSearchResultWithMetadata(getDocumentMetadataRecord(database, row.id), row),
    )
    .filter((row): row is KnowledgeDocumentSearchResult => Boolean(row));
  await saveDB();
  return {
    results,
    metrics: response.metrics,
  };
}
