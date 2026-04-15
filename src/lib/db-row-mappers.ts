import { toBoolean } from './db-row-helpers';
import type {
  AgentLane,
  AssistantProfile,
  ChatMessage,
  ConversationSummary,
  GlobalMemoryDocument,
  PromptSnippet,
  StoredToolRun,
} from './db-types';

export function parseTools(raw: unknown): StoredToolRun[] | undefined {
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

export function toConversationSummary(row: {
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

export function toAssistantProfile(row: {
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

export function toPromptSnippet(row: {
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

export function toGlobalMemoryDocument(row: {
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

export function toAgentLane(row: {
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

export function toChatMessage(row: {
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
