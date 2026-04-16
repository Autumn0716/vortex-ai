import type { Database } from './db-core';

export function createBaseSchema(database: Database) {
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

    CREATE TABLE IF NOT EXISTS token_usage (
      id TEXT PRIMARY KEY,
      topic_id TEXT NOT NULL,
      topic_title TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      provider_id TEXT,
      model TEXT NOT NULL,
      session_mode TEXT NOT NULL DEFAULT 'agent',
      message_id TEXT NOT NULL UNIQUE,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      total_tokens INTEGER NOT NULL,
      estimated_cost REAL,
      usage_source TEXT NOT NULL,
      stream_duration_ms INTEGER,
      reasoning_duration_ms INTEGER,
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
    CREATE INDEX IF NOT EXISTS idx_token_usage_topic_created ON token_usage(topic_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_token_usage_model_created ON token_usage(model, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_token_usage_created ON token_usage(created_at DESC);
  `);
}
