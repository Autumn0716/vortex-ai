import { buildAgentWorkspacePath } from './agent-workspace-model';
import { getAgentRow, toAgentProfile, toTopicSummary } from './agent-workspace-read-model';
import type {
  AgentProfile,
  TopicModelFeatures,
  TopicSessionMode,
  TopicSummary,
} from './agent-workspace-types';
import { getScalar, mapRows } from './agent-workspace-queries';
import { runDatabaseTransaction } from './db-transaction';
import type { Database } from './db';

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `${prefix}_${uuid ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
}

export function listAgentsInDatabase(database: Database): AgentProfile[] {
  const rows = mapRows<{
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
    `),
  );

  return rows.map(toAgentProfile);
}

export async function saveAgentInDatabase(
  database: Database,
  draft: Omit<AgentProfile, 'slug' | 'workspaceRelpath' | 'createdAt' | 'updatedAt' | 'isDefault'> & {
    isDefault?: boolean;
    workspaceRelpath?: string;
  },
): Promise<AgentProfile> {
  const timestamp = nowIso();
  const id = draft.id || createId('agent');
  const workspaceRelpath = draft.workspaceRelpath?.trim() || buildAgentWorkspacePath(draft.name);
  const slug = workspaceRelpath.replace(/^agents\//, '') || id;
  const exists = Number(getScalar(database, 'SELECT COUNT(*) FROM agents WHERE id = ?', [id]) ?? 0);

  await runDatabaseTransaction(database, () => {
    if (draft.isDefault) {
      database.run('UPDATE agents SET is_default = 0');
    }

    if (exists > 0) {
      database.run(
        `
          UPDATE agents
          SET
            slug = ?,
            name = ?,
            description = ?,
            system_prompt = ?,
            provider_id = ?,
            model = ?,
            accent_color = ?,
            workspace_relpath = ?,
            is_default = ?,
            updated_at = ?
          WHERE id = ?
        `,
        [
          slug,
          draft.name.trim(),
          draft.description.trim(),
          draft.systemPrompt.trim(),
          draft.providerId ?? null,
          draft.model ?? null,
          draft.accentColor,
          workspaceRelpath,
          draft.isDefault ? 1 : 0,
          timestamp,
          id,
        ],
      );
    } else {
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
          id,
          slug,
          draft.name.trim(),
          draft.description.trim(),
          draft.systemPrompt.trim(),
          draft.providerId ?? null,
          draft.model ?? null,
          draft.accentColor,
          workspaceRelpath,
          draft.isDefault ? 1 : 0,
          timestamp,
          timestamp,
        ],
      );
    }
  });

  const agent = getAgentRow(database, id);
  if (!agent) {
    throw new Error('Failed to save agent.');
  }

  return agent;
}

export function listTopicsInDatabase(database: Database, agentId: string): TopicSummary[] {
  const rows = mapRows<{
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
        WHERE t.agent_id = ?
        ORDER BY t.last_message_at DESC, t.updated_at DESC, t.created_at DESC
      `,
      [agentId],
    ),
  );

  return rows.map(toTopicSummary);
}
