import localforage from 'localforage';
import type { Database } from './db';
import { mapRows } from './agent-workspace-queries';
import { resolveActiveAgentId } from './agent-workspace-model';

export const ACTIVE_AGENT_KEY = 'vortex_active_agent_id_v2';
export const ACTIVE_TOPIC_KEY = 'vortex_active_topic_id_v2';

export async function resolveAgentIdForMemorySync(
  database: Database,
  preferredAgentId?: string | null,
): Promise<string | null> {
  if (preferredAgentId) {
    return preferredAgentId;
  }

  const storedAgentId = await localforage.getItem<string>(ACTIVE_AGENT_KEY);
  const agents = mapRows<{ id: string }>(
    database.exec(`
      SELECT id
      FROM agents
      ORDER BY is_default DESC, created_at ASC
    `),
  );

  return resolveActiveAgentId(
    storedAgentId,
    agents.map((agent) => agent.id),
  );
}

export async function getActiveAgentIdFromStore(agentIds: string[]): Promise<string | null> {
  const stored = await localforage.getItem<string>(ACTIVE_AGENT_KEY);
  const resolved = resolveActiveAgentId(stored, agentIds);

  if (stored !== resolved) {
    if (resolved) {
      await localforage.setItem(ACTIVE_AGENT_KEY, resolved);
    } else {
      await localforage.removeItem(ACTIVE_AGENT_KEY);
    }
  }

  return resolved;
}

export async function setActiveAgentIdInStore(agentId: string) {
  await localforage.setItem(ACTIVE_AGENT_KEY, agentId);
}

export async function getActiveTopicIdFromStore(): Promise<string | null> {
  return (await localforage.getItem<string>(ACTIVE_TOPIC_KEY)) ?? null;
}

export async function setActiveTopicIdInStore(topicId: string) {
  await localforage.setItem(ACTIVE_TOPIC_KEY, topicId);
}
