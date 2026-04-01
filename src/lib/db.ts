import initSqlJs, { Database, type QueryExecResult, type SqlValue } from 'sql.js';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import localforage from 'localforage';

let db: Database | null = null;
let initPromise: Promise<Database> | null = null;

const DB_STORAGE_KEY = 'sqlite_db';
const ACTIVE_CONVERSATION_KEY = 'flowagent_active_conversation_id';
const DEFAULT_CONVERSATION_TITLE = 'New Conversation';
const LEGACY_WELCOME_MESSAGE =
  'Hello! I am your FlowAgent. SQLite is now connected for local storage and RAG. How can I assist you today?';

export interface StoredToolRun {
  name: string;
  status: 'running' | 'completed' | 'failed';
  result?: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
  preview: string;
  laneCount: number;
}

export interface AssistantProfile {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  providerId?: string;
  model?: string;
  accentColor: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PromptSnippet {
  id: string;
  title: string;
  content: string;
  category: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentLane {
  id: string;
  conversationId: string;
  assistantId: string;
  name: string;
  description: string;
  systemPrompt: string;
  providerId?: string;
  model?: string;
  accentColor: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  laneId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  authorName: string;
  content: string;
  createdAt: string;
  tools?: StoredToolRun[];
}

export interface ChatMessageInput {
  id?: string;
  conversationId: string;
  laneId: string;
  role: ChatMessage['role'];
  authorName: string;
  content: string;
  createdAt?: string;
  tools?: StoredToolRun[];
}

export interface ConversationWorkspace {
  conversation: ConversationSummary;
  lanes: AgentLane[];
  messagesByLane: Record<string, ChatMessage[]>;
}

export interface DataStats {
  conversations: number;
  lanes: number;
  messages: number;
  documents: number;
  memoryDocuments: number;
  assistants: number;
  snippets: number;
}

export interface GlobalMemoryDocument {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

interface AssistantSeed {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  accentColor: string;
  providerId?: string;
  model?: string;
  isDefault?: boolean;
}

interface PromptSeed {
  id: string;
  title: string;
  content: string;
  category: string;
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
    const obj: SqlRow = {};
    entry.columns.forEach((column, index) => {
      obj[column] = row[index];
    });
    return obj as T;
  });
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

function getScalar(database: Database, query: string, params: SqlValue[] = []): unknown {
  const result = database.exec(query, params);
  if (result.length === 0 || result[0]!.values.length === 0) {
    return null;
  }

  return result[0]!.values[0]![0];
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
  `);

  await seedAssistants(database);
  await seedPromptSnippets(database);
  await seedInitialConversation(database);
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
      const SQL = await initSqlJs({
        locateFile: () => sqlWasmUrl,
      });

      const savedData = await localforage.getItem<Uint8Array>(DB_STORAGE_KEY);
      if (savedData) {
        try {
          db = new SQL.Database(savedData);
        } catch (error) {
          console.warn('Failed to load saved database, recreating it:', error);
          await localforage.removeItem(DB_STORAGE_KEY);
          db = new SQL.Database();
        }
      } else {
        db = new SQL.Database();
      }

      await ensureSchema(db);
      await saveDB();
      return db;
    } catch (error) {
      console.error('Failed to initialize SQLite:', error);
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

  database.run('BEGIN');
  try {
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

    database.run('COMMIT');
  } catch (error) {
    database.run('ROLLBACK');
    throw error;
  }

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
  database.run('BEGIN');
  try {
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
    database.run('COMMIT');
  } catch (error) {
    database.run('ROLLBACK');
    throw error;
  }

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
  database.run('BEGIN');
  try {
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
    database.run('COMMIT');
  } catch (error) {
    database.run('ROLLBACK');
    throw error;
  }

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

  database.run('BEGIN');
  try {
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
    database.run('COMMIT');
  } catch (error) {
    database.run('ROLLBACK');
    throw error;
  }

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

  database.run('BEGIN');
  try {
    [
      'messages',
      'chat_messages',
      'agent_lanes',
      'conversations',
      'assistants',
      'prompt_snippets',
      'documents',
      'global_memory_documents',
    ].forEach((table) => {
      database.run(`DELETE FROM ${table}`);
    });

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

    database.run('COMMIT');
  } catch (error) {
    database.run('ROLLBACK');
    throw error;
  }

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

export async function addDocument(id: string, title: string, content: string) {
  const database = await initDB();
  database.run('INSERT INTO documents (id, title, content) VALUES (?, ?, ?)', [
    id,
    title,
    content,
  ]);
  await saveDB();
}

export async function getDocuments() {
  const database = await initDB();
  try {
    const res = database.exec('SELECT id, title, content FROM documents ORDER BY rowid DESC');
    if (res.length === 0) {
      return [];
    }

    return res[0]!.values.map((row) => ({
      id: String(row[0]),
      title: String(row[1]),
      content: String(row[2]),
    }));
  } catch {
    return [];
  }
}

export async function deleteDocument(id: string) {
  const database = await initDB();
  database.run('DELETE FROM documents WHERE id = ?', [id]);
  await saveDB();
}

export async function searchDocuments(query: string) {
  const database = await initDB();
  try {
    if (!query.trim()) {
      return [];
    }

    const words = query
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 1);

    if (words.length === 0) {
      return [];
    }

    const conditions = words.map(() => '(title LIKE ? OR content LIKE ?)').join(' OR ');
    const params = words.flatMap((word) => [`%${word}%`, `%${word}%`]);
    const result = database.exec(
      `SELECT id, title, content FROM documents WHERE ${conditions} LIMIT 5`,
      params,
    );

    if (result.length === 0) {
      return [];
    }

    return result[0]!.values.map((row) => ({
      id: String(row[0]),
      title: String(row[1]),
      content: String(row[2]),
    }));
  } catch (error) {
    console.error('Search error:', error);
    return [];
  }
}
