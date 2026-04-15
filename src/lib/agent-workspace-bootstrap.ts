import { createFts5Tables } from './db-fts5-helpers';
import { runDatabaseTransaction } from './db-transaction';
import { getScalar, mapRows } from './agent-workspace-queries';
import {
  buildAgentWorkspacePath,
  buildMigratedTopicTitle,
  DEFAULT_TOPIC_TITLE,
} from './agent-workspace-model';
import {
  getAgentRow,
  getDefaultAgent,
} from './agent-workspace-read-model';
import { ensureAgentWorkspaceSchema } from './agent-workspace-schema';
import type { Database } from './db';

const FALLBACK_AGENT_SEED = {
  id: 'agent_flowagent_core',
  name: 'FlowAgent Core',
  description: 'Balanced general-purpose agent for research, planning, and implementation.',
  systemPrompt:
    'You are FlowAgent Core. Be pragmatic, structured, and concise. Use tools when they materially improve the answer.',
  accentColor: 'from-blue-500/20 to-violet-500/20',
};

let ensuredPromise: Promise<void> | null = null;
let fts5Available: boolean | null = null;

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `${prefix}_${uuid ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
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

  await runDatabaseTransaction(database, () => {
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
          role: 'user' | 'assistant' | 'system' | 'tool';
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
                attachments_json,
                tools_json,
                created_at
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
              `topic_${message.id}`,
              topicId,
              agentId,
              message.role,
              message.author_name,
              message.content,
              null,
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
  });

  return true;
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

export async function ensureAgentWorkspaceDatabase(options: {
  initDB: () => Promise<Database>;
  saveDB: () => Promise<void>;
  syncCurrentAgentMemory: (options: { database: Database; persist?: boolean }) => Promise<{ changed: boolean } | null>;
}): Promise<Database> {
  const database = await options.initDB();
  if (!ensuredPromise) {
    ensuredPromise = (async () => {
      try {
        ensureAgentWorkspaceSchema(database);

        fts5Available = createFts5Tables(database, [
          {
            tableName: 'topic_title_fts',
            columns: ['topic_id UNINDEXED', 'agent_id UNINDEXED', 'title'],
          },
          {
            tableName: 'message_content_fts',
            columns: ['message_id UNINDEXED', 'topic_id UNINDEXED', 'agent_id UNINDEXED', 'content'],
          },
        ]);

        const migrated = await migrateLegacyWorkspace(database);
        const seeded = seedFallbackWorkspace(database);
        const syncResult = await options.syncCurrentAgentMemory({
          database,
          persist: false,
        });

        if (migrated || seeded || syncResult?.changed) {
          await options.saveDB();
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

export async function persistAndMaybeRebuildWorkspaceFts(database: Database, saveDB: () => Promise<void>) {
  if (fts5Available) {
    rebuildFtsIndexes(database);
  }
  await saveDB();
}

export async function getAgentWorkspaceSearchCapabilities(ensureDatabase: () => Promise<Database>) {
  await ensureDatabase();
  return { fts5Available: Boolean(fts5Available) };
}

export function isAgentWorkspaceFtsAvailable() {
  return Boolean(fts5Available);
}
