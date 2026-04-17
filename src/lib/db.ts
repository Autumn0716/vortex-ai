import localforage from 'localforage';
import { getAgentConfig } from './agent/config';
import { type KnowledgeDocumentSourceType } from './knowledge-document-model';
import { createFts5Table } from './db-fts5-helpers';
import {
  clearDocumentChunks,
  clearDocumentGraph,
  ensureDocumentIndexes,
  getDocumentFtsEnabled,
  indexDocumentChunks,
} from './db-document-indexing';
import {
  buildEmbeddingConfigFromDocuments,
  deleteDocumentChunkEmbeddings,
  parseEmbeddingJson,
} from './db-embeddings';
import { runDatabaseTransaction } from './db-transaction';
import { Database, initializeSqliteModule, type SQLiteModule, type SqlValue, type QueryExecResult } from './db-core';
import {
  getDocumentMetadataRecord,
  mergeSearchResultWithMetadata,
} from './db-knowledge-documents';
import {
  addConversationMessagesInDatabase,
  addLaneToConversationInDatabase,
  createConversationInDatabase,
  getConversationWorkspaceFromDatabase,
  listConversationsInDatabase,
  updateConversationTitleInDatabase,
} from './db-conversations';
import {
  deleteDocumentInDatabase,
  getDocumentsInDatabase,
  upsertKnowledgeDocumentInDatabase,
} from './db-knowledge-operations';
import {
  deleteGlobalMemoryDocumentInDatabase,
  listGlobalMemoryDocumentsInDatabase,
  saveGlobalMemoryDocumentInDatabase,
} from './db-global-memory';
import { importWorkspaceDataIntoDatabase } from './db-workspace-import';
import {
  searchDocumentsInDatabase,
  searchDocumentsInDatabaseWithMetrics,
} from './db-search-orchestrator';
import {
  listAssistantsInDatabase,
  listPromptSnippetsInDatabase,
  saveAssistantInDatabase,
  savePromptSnippetInDatabase,
} from './db-library-data';
import {
  accumulateTokenUsage,
  getTokenUsageSummaryInDatabase,
  listTokenUsageForTopicInDatabase,
  upsertTokenUsageInDatabase,
} from './db-usage';
import { insertAuditLogInDatabase, listAuditLogsInDatabase } from './db-audit';
import {
  listDocumentQualityScoresInDatabase,
  refreshDocumentQualityScoresInDatabase,
  upsertDocumentQualityScore,
} from './db-document-quality';
import { getScalar, mapRows } from './db-row-helpers';
import { toConversationSummary } from './db-row-mappers';
import { createBaseSchema } from './db-schema';
import {
  ACTIVE_CONVERSATION_KEY,
  buildLaneWelcomeMessage,
  createLaneFromAssistant,
  DEFAULT_CONVERSATION_TITLE,
  getAssistantRow,
  getDefaultAssistant,
  seedAssistants,
  seedInitialConversation,
  seedPromptSnippets,
} from './db-bootstrap';
import {
  clearDocumentSearchCache,
} from './db-search-cache';
import type {
  AgentLane,
  AssistantProfile,
  ChatMessage,
  ChatMessageInput,
  ConversationSummary,
  ConversationWorkspace,
  DataStats,
  AuditLogRecord,
  GlobalMemoryDocument,
  KnowledgeDocumentRecord,
  KnowledgeDocumentSearchMetrics,
  KnowledgeDocumentSearchOptions,
  KnowledgeDocumentSearchResponse,
  KnowledgeDocumentSearchResult,
  KnowledgeDocumentSupportMetadata,
  KnowledgeEvidenceFeedbackInput,
  PromptSnippet,
  StoredToolRun,
  TokenUsageAggregate,
  TokenUsageRecord,
  TokenUsageSummary,
  DocumentQualityScoreRecord,
} from './db-types';

export { Database };
export {
  accumulateTokenUsage,
  buildEmbeddingConfigFromDocuments,
  clearDocumentSearchCache,
  getDocumentFtsEnabled,
  indexDocumentChunks,
  parseEmbeddingJson,
  searchDocumentsInDatabase,
};
export type { QueryExecResult, SqlValue };
export type {
  AgentLane,
  AssistantProfile,
  ChatMessage,
  ChatMessageInput,
  ConversationSummary,
  ConversationWorkspace,
  DataStats,
  AuditLogRecord,
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
  TokenUsageAggregate,
  TokenUsageRecord,
  TokenUsageSummary,
  DocumentQualityScoreRecord,
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

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `${prefix}_${uuid ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
}

async function ensureSchema(database: Database) {
  createBaseSchema(database);

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
  upsertDocumentQualityScore(database, input.documentId);
  clearDocumentSearchCache(database);
  await saveDB();
}

export async function listDocumentQualityScores(): Promise<DocumentQualityScoreRecord[]> {
  const database = await initDB();
  const scores = listDocumentQualityScoresInDatabase(database);
  await saveDB();
  return scores;
}

export async function refreshDocumentQualityScores(): Promise<DocumentQualityScoreRecord[]> {
  const database = await initDB();
  const scores = refreshDocumentQualityScoresInDatabase(database);
  clearDocumentSearchCache(database);
  await saveDB();
  return scores;
}

async function getEmbeddingConfig() {
  const config = await getAgentConfig();
  return buildEmbeddingConfigFromDocuments(config.documents);
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
  return listConversationsInDatabase(database);
}

export async function getConversationWorkspace(
  conversationId: string,
): Promise<ConversationWorkspace | null> {
  const database = await initDB();
  return getConversationWorkspaceFromDatabase(database, conversationId);
}

export async function createConversation(options?: {
  title?: string;
  assistantIds?: string[];
}): Promise<ConversationWorkspace> {
  const database = await initDB();
  const { conversationId } = await createConversationInDatabase(database, options);

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
  await addLaneToConversationInDatabase(database, conversationId, assistantId);

  await saveDB();
  const workspace = await getConversationWorkspace(conversationId);
  if (!workspace) {
    throw new Error('Failed to add lane.');
  }
  return workspace;
}

export async function addConversationMessages(messages: ChatMessageInput[]) {
  const database = await initDB();
  await addConversationMessagesInDatabase(database, messages);

  await saveDB();
}

export async function updateConversationTitle(conversationId: string, title: string) {
  const database = await initDB();
  updateConversationTitleInDatabase(database, conversationId, title);
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
  return listAssistantsInDatabase(database);
}

export async function saveAssistant(
  draft: Omit<AssistantProfile, 'createdAt' | 'updatedAt' | 'isDefault'> & { isDefault?: boolean },
): Promise<AssistantProfile> {
  const database = await initDB();
  const assistant = await saveAssistantInDatabase(database, draft);
  await saveDB();
  return assistant;
}

export async function listPromptSnippets(): Promise<PromptSnippet[]> {
  const database = await initDB();
  return listPromptSnippetsInDatabase(database);
}

export async function savePromptSnippet(
  draft: Omit<PromptSnippet, 'createdAt' | 'updatedAt'>,
): Promise<PromptSnippet> {
  const database = await initDB();
  const snippet = savePromptSnippetInDatabase(database, draft);
  await saveDB();
  return snippet;
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

export async function recordTokenUsage(input: Omit<TokenUsageRecord, 'id'> & { id?: string }) {
  const database = await initDB();
  upsertTokenUsageInDatabase(database, input);
  await saveDB();
}

export async function listTopicTokenUsage(topicId: string): Promise<TokenUsageRecord[]> {
  const database = await initDB();
  return listTokenUsageForTopicInDatabase(database, topicId);
}

export async function getTokenUsageSummary(options?: {
  now?: string;
  dailyWindowDays?: number;
}): Promise<TokenUsageSummary> {
  const database = await initDB();
  return getTokenUsageSummaryInDatabase(database, options);
}

export async function recordAuditLog(input: Omit<AuditLogRecord, 'id'> & { id?: string }) {
  const database = await initDB();
  insertAuditLogInDatabase(database, input);
  await saveDB();
}

export async function listAuditLogs(options?: {
  category?: AuditLogRecord['category'];
  topicId?: string;
  limit?: number;
}): Promise<AuditLogRecord[]> {
  const database = await initDB();
  return listAuditLogsInDatabase(database, options);
}

export async function listGlobalMemoryDocuments(): Promise<GlobalMemoryDocument[]> {
  const database = await initDB();
  return listGlobalMemoryDocumentsInDatabase(database);
}

export async function saveGlobalMemoryDocument(draft: {
  id?: string;
  title: string;
  content: string;
}) {
  const database = await initDB();
  const document = saveGlobalMemoryDocumentInDatabase(database, draft);
  await saveDB();
  return document;
}

export async function deleteGlobalMemoryDocument(id: string) {
  const database = await initDB();
  deleteGlobalMemoryDocumentInDatabase(database, id);
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
  const { preferredConversationId, shouldSeedConversation } =
    await importWorkspaceDataIntoDatabase(database, payload);

  if (shouldSeedConversation) {
    await seedInitialConversation(database);
  }

  await saveDB();

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
  const changed = await upsertKnowledgeDocumentInDatabase(database, record, {
    ...options,
    embeddingConfig: options?.skipEmbeddings ? null : await getEmbeddingConfig(),
  });
  if (!changed) {
    return false;
  }
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
  return getDocumentsInDatabase(database);
}

export async function deleteDocument(id: string) {
  const database = await initDB();
  deleteDocumentInDatabase(database, id);
  await saveDB();
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
