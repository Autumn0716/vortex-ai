import type { QueryExecResult, SqlValue } from './db';

type SchemaDatabase = {
  exec: (query: string, params?: SqlValue[]) => QueryExecResult[];
  run: (query: string, params?: SqlValue[]) => void;
};

type SqlRow = Record<string, unknown>;

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

function hasColumn(database: SchemaDatabase, table: string, column: string) {
  const rows = mapRows<{ name: string }>(database.exec(`PRAGMA table_info(${table})`));
  return rows.some((row) => row.name === column);
}

function ensureColumn(database: SchemaDatabase, table: string, column: string, definition: string) {
  if (!hasColumn(database, table, column)) {
    database.run(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }
}

export function ensureAgentWorkspaceSchema(database: SchemaDatabase) {
  database.run(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      system_prompt TEXT NOT NULL,
      provider_id TEXT,
      model TEXT,
      accent_color TEXT NOT NULL,
      workspace_relpath TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS topics (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      parent_topic_id TEXT,
      session_mode TEXT NOT NULL DEFAULT 'agent',
      display_name TEXT,
      system_prompt_override TEXT,
      provider_id_override TEXT,
      model_override TEXT,
      model_features_json TEXT,
      enable_memory INTEGER NOT NULL DEFAULT 1,
      enable_skills INTEGER NOT NULL DEFAULT 1,
      enable_tools INTEGER NOT NULL DEFAULT 1,
      enable_agent_shared_short_term INTEGER NOT NULL DEFAULT 0,
      session_summary TEXT,
      session_summary_updated_at TEXT,
      session_summary_message_count INTEGER NOT NULL DEFAULT 0,
      title TEXT NOT NULL,
      title_source TEXT NOT NULL DEFAULT 'auto',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_message_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS topic_messages (
      id TEXT PRIMARY KEY,
      topic_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      role TEXT NOT NULL,
      author_name TEXT NOT NULL,
      content TEXT NOT NULL,
      attachments_json TEXT,
      tools_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_memory_documents (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      memory_scope TEXT NOT NULL DEFAULT 'global',
      source_type TEXT NOT NULL DEFAULT 'manual',
      importance_score INTEGER NOT NULL DEFAULT 3,
      topic_id TEXT,
      event_date TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_memory_embeddings (
      memory_document_id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      event_date TEXT,
      source_type TEXT NOT NULL,
      embedding_model TEXT NOT NULL,
      embedding_dimensions INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      embedding_json TEXT NOT NULL,
      content_preview TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS topic_task_graphs (
      id TEXT PRIMARY KEY,
      topic_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      title TEXT NOT NULL,
      goal TEXT NOT NULL,
      summary TEXT NOT NULL,
      compiler_provider_id TEXT,
      compiler_model TEXT,
      compiler_strategy TEXT NOT NULL DEFAULT 'fallback',
      status TEXT NOT NULL DEFAULT 'draft',
      graph_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS topic_task_nodes (
      id TEXT PRIMARY KEY,
      graph_id TEXT NOT NULL,
      topic_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      node_key TEXT NOT NULL,
      node_type TEXT NOT NULL,
      title TEXT NOT NULL,
      objective TEXT NOT NULL,
      acceptance_criteria TEXT NOT NULL,
      depends_on_json TEXT NOT NULL,
      branch_topic_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS topic_task_edges (
      id TEXT PRIMARY KEY,
      graph_id TEXT NOT NULL,
      from_node_key TEXT NOT NULL,
      to_node_key TEXT NOT NULL,
      edge_type TEXT NOT NULL DEFAULT 'depends_on',
      created_at TEXT NOT NULL
    );
  `);

  ensureColumn(database, 'agent_memory_documents', 'memory_scope', "memory_scope TEXT NOT NULL DEFAULT 'global'");
  ensureColumn(database, 'agent_memory_documents', 'source_type', "source_type TEXT NOT NULL DEFAULT 'manual'");
  ensureColumn(database, 'agent_memory_documents', 'importance_score', "importance_score INTEGER NOT NULL DEFAULT 3");
  ensureColumn(database, 'agent_memory_documents', 'topic_id', 'topic_id TEXT');
  ensureColumn(database, 'agent_memory_documents', 'event_date', 'event_date TEXT');
  ensureColumn(database, 'topics', 'session_mode', "session_mode TEXT NOT NULL DEFAULT 'agent'");
  ensureColumn(database, 'topics', 'parent_topic_id', 'parent_topic_id TEXT');
  ensureColumn(database, 'topics', 'display_name', 'display_name TEXT');
  ensureColumn(database, 'topics', 'system_prompt_override', 'system_prompt_override TEXT');
  ensureColumn(database, 'topics', 'provider_id_override', 'provider_id_override TEXT');
  ensureColumn(database, 'topics', 'model_override', 'model_override TEXT');
  ensureColumn(database, 'topics', 'model_features_json', 'model_features_json TEXT');
  ensureColumn(database, 'topics', 'enable_memory', 'enable_memory INTEGER NOT NULL DEFAULT 1');
  ensureColumn(database, 'topics', 'enable_skills', 'enable_skills INTEGER NOT NULL DEFAULT 1');
  ensureColumn(database, 'topics', 'enable_tools', 'enable_tools INTEGER NOT NULL DEFAULT 1');
  ensureColumn(database, 'topics', 'session_summary', 'session_summary TEXT');
  ensureColumn(database, 'topics', 'session_summary_updated_at', 'session_summary_updated_at TEXT');
  ensureColumn(
    database,
    'topics',
    'session_summary_message_count',
    'session_summary_message_count INTEGER NOT NULL DEFAULT 0',
  );
  ensureColumn(database, 'topic_messages', 'attachments_json', 'attachments_json TEXT');
  ensureColumn(
    database,
    'topics',
    'enable_agent_shared_short_term',
    'enable_agent_shared_short_term INTEGER NOT NULL DEFAULT 0',
  );

  database.run(`
    CREATE INDEX IF NOT EXISTS idx_agents_default ON agents(is_default DESC, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_topics_agent_updated ON topics(agent_id, last_message_at DESC, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_topics_parent_updated ON topics(parent_topic_id, last_message_at DESC, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_topic_messages_topic_created ON topic_messages(topic_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_topic_messages_agent_created ON topic_messages(agent_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_memory_agent_updated ON agent_memory_documents(agent_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_memory_scope_updated ON agent_memory_documents(agent_id, memory_scope, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_memory_embeddings_agent_source ON agent_memory_embeddings(agent_id, source_type, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_memory_embeddings_agent_event ON agent_memory_embeddings(agent_id, event_date DESC);
    CREATE INDEX IF NOT EXISTS idx_topic_task_graphs_topic_created ON topic_task_graphs(topic_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_topic_task_nodes_graph_order ON topic_task_nodes(graph_id, sort_order ASC);
    CREATE INDEX IF NOT EXISTS idx_topic_task_nodes_branch ON topic_task_nodes(branch_topic_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_topic_task_edges_graph ON topic_task_edges(graph_id, created_at ASC);
  `);
}
