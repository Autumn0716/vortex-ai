import localforage from 'localforage';
import { Database } from './db-core';
import { getScalar, mapRows } from './db-row-helpers';
import { toAssistantProfile } from './db-row-mappers';
import type {
  AgentLane,
  AssistantProfile,
  AssistantSeed,
  ChatMessageInput,
  PromptSeed,
} from './db-types';

export const ACTIVE_CONVERSATION_KEY = 'flowagent_active_conversation_id';
export const DEFAULT_CONVERSATION_TITLE = 'New Conversation';

const LEGACY_WELCOME_MESSAGE =
  'Hello! I am your FlowAgent. SQLite is now connected for local storage and RAG. How can I assist you today?';

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

export function getAssistantRow(database: Database, assistantId: string) {
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

export function getDefaultAssistant(database: Database): AssistantProfile {
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

export function createLaneFromAssistant(
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

export function buildLaneWelcomeMessage(lane: AgentLane): ChatMessageInput {
  return {
    conversationId: lane.conversationId,
    laneId: lane.id,
    role: 'assistant',
    authorName: lane.name,
    content: `I’m ${lane.name}. ${lane.description} Send a task and I’ll work through it with the tools available in this workspace.`,
  };
}

export async function seedAssistants(database: Database) {
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

export async function seedPromptSnippets(database: Database) {
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

export async function seedInitialConversation(database: Database) {
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
        conversationId,
        lane.id,
        'assistant',
        lane.name,
        LEGACY_WELCOME_MESSAGE,
        null,
        timestamp,
      ],
    );
  }

  await localforage.setItem(ACTIVE_CONVERSATION_KEY, conversationId);
}
