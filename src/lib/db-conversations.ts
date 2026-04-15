import {
  buildLaneWelcomeMessage,
  createLaneFromAssistant,
  DEFAULT_CONVERSATION_TITLE,
  getAssistantRow,
  getDefaultAssistant,
} from './db-bootstrap';
import { Database } from './db-core';
import { getScalar, mapRows } from './db-row-helpers';
import { toAgentLane, toChatMessage, toConversationSummary } from './db-row-mappers';
import { runDatabaseTransaction } from './db-transaction';
import type {
  ChatMessage,
  ChatMessageInput,
  ConversationSummary,
  ConversationWorkspace,
} from './db-types';

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `${prefix}_${uuid ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
}

export function listConversationsInDatabase(database: Database): ConversationSummary[] {
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

export function getConversationWorkspaceFromDatabase(
  database: Database,
  conversationId: string,
): ConversationWorkspace | null {
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

export async function createConversationInDatabase(
  database: Database,
  options?: {
    title?: string;
    assistantIds?: string[];
  },
) {
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

  return { conversationId };
}

export async function addLaneToConversationInDatabase(
  database: Database,
  conversationId: string,
  assistantId: string,
) {
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
}

export async function addConversationMessagesInDatabase(
  database: Database,
  messages: ChatMessageInput[],
) {
  if (messages.length === 0) {
    return;
  }

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
}

export function updateConversationTitleInDatabase(
  database: Database,
  conversationId: string,
  title: string,
) {
  const normalizedTitle = title.trim() || DEFAULT_CONVERSATION_TITLE;
  const timestamp = nowIso();
  database.run('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?', [
    normalizedTitle,
    timestamp,
    conversationId,
  ]);
}
