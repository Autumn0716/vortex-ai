import type { Database, StoredToolRun } from './db';
import type { MemoryScope, MemorySourceType } from './agent-memory-model';
import { formatTopicPreview } from './agent-workspace-model';
import { mapRows } from './agent-workspace-queries';
import {
  normalizeTopicModelFeatures,
  parseTopicModelFeatures,
  warnJsonFallback,
} from './agent-workspace-model-features';
import type {
  AgentMemoryDocument,
  AgentProfile,
  TopicMessage,
  TopicMessageAttachment,
  TopicRuntimeProfile,
  TopicSessionMode,
  TopicSummary,
} from './agent-workspace-types';

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
    warnJsonFallback('topic message tool metadata', raw, error);
    return undefined;
  }
}

function parseAttachments(raw: unknown): TopicMessageAttachment[] | undefined {
  if (!raw) {
    return undefined;
  }

  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? (parsed as TopicMessageAttachment[]) : undefined;
  } catch (error) {
    warnJsonFallback('topic message attachments', raw, error);
    return undefined;
  }
}

export function toAgentProfile(row: {
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

export function toTopicSummary(row: {
  id: string;
  agent_id: string;
  parent_topic_id: string | null;
  session_mode: TopicSessionMode | null;
  display_name: string | null;
  system_prompt_override: string | null;
  provider_id_override: string | null;
  model_override: string | null;
  model_features_json: string | null;
  enable_memory: number | null;
  enable_skills: number | null;
  enable_tools: number | null;
  enable_agent_shared_short_term: number | null;
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
    parentTopicId: row.parent_topic_id ?? undefined,
    sessionMode: row.session_mode === 'quick' ? 'quick' : 'agent',
    displayName: row.display_name ?? undefined,
    systemPromptOverride: row.system_prompt_override ?? undefined,
    providerIdOverride: row.provider_id_override ?? undefined,
    modelOverride: row.model_override ?? undefined,
    modelFeatures: parseTopicModelFeatures(row.model_features_json),
    enableMemory: row.enable_memory == null ? true : toBoolean(row.enable_memory),
    enableSkills: row.enable_skills == null ? true : toBoolean(row.enable_skills),
    enableTools: row.enable_tools == null ? true : toBoolean(row.enable_tools),
    enableAgentSharedShortTerm:
      row.enable_agent_shared_short_term == null ? false : toBoolean(row.enable_agent_shared_short_term),
    title: row.title,
    titleSource: row.title_source,
    preview: formatTopicPreview(String(row.preview ?? '')),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastMessageAt: row.last_message_at,
    messageCount: Number(row.message_count) || 0,
  };
}

export function resolveTopicRuntimeProfile(topic: TopicSummary, agent: AgentProfile): TopicRuntimeProfile {
  const displayName = topic.displayName?.trim() || (topic.sessionMode === 'quick' ? topic.title : agent.name);
  const systemPrompt =
    topic.systemPromptOverride?.trim() ||
    (topic.sessionMode === 'quick'
      ? 'You are a concise, helpful AI assistant. Follow the user-defined identity and system instructions.'
      : agent.systemPrompt);

  return {
    sessionMode: topic.sessionMode,
    displayName,
    systemPrompt,
    providerId: topic.providerIdOverride ?? agent.providerId,
    model: topic.modelOverride ?? agent.model,
    modelFeatures: normalizeTopicModelFeatures(topic.modelFeatures),
    enableMemory: topic.enableMemory,
    enableSkills: topic.enableSkills,
    enableTools: topic.enableTools,
    enableAgentSharedShortTerm: topic.enableAgentSharedShortTerm,
  };
}

export function toTopicMessage(row: {
  id: string;
  topic_id: string;
  agent_id: string;
  role: TopicMessage['role'];
  author_name: string;
  content: string;
  attachments_json: string | null;
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
    attachments: parseAttachments(row.attachments_json),
    tools: parseTools(row.tools_json),
  };
}

export function toAgentMemoryDocument(row: {
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

export function fetchTopicSummaryById(database: Database, topicId: string): TopicSummary | null {
  const row = mapRows<{
    id: string;
    agent_id: string;
    parent_topic_id: string | null;
    session_mode: TopicSessionMode | null;
    display_name: string | null;
    system_prompt_override: string | null;
    provider_id_override: string | null;
    model_override: string | null;
    model_features_json: string | null;
    enable_memory: number | null;
    enable_skills: number | null;
    enable_tools: number | null;
    enable_agent_shared_short_term: number | null;
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
          t.parent_topic_id,
          t.session_mode,
          t.display_name,
          t.system_prompt_override,
          t.provider_id_override,
          t.model_override,
          t.model_features_json,
          t.enable_memory,
          t.enable_skills,
          t.enable_tools,
          t.enable_agent_shared_short_term,
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

  return row ? toTopicSummary(row) : null;
}

export function getAgentRow(database: Database, agentId: string): AgentProfile | null {
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

export function getDefaultAgent(database: Database): AgentProfile {
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
