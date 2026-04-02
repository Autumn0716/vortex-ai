import type { ApiServerSettings } from './agent/config';
import { createAgentMemoryApiFileStore } from './agent-memory-api';
import { deleteDocument, getDocuments, searchKnowledgeDocuments, syncKnowledgeDocuments } from './db';
import { createPathScopedKnowledgeRecord } from './project-knowledge-model';

const AGENT_SKILL_ID_PREFIX = 'agent_skill_';
const SHARED_SKILL_PREFIX = 'skills/';

function createAgentSkillPrefix(agentId: string) {
  return `memory/agents/${agentId}/skills`;
}

function isManagedAgentSkillId(id: string) {
  return id.startsWith(AGENT_SKILL_ID_PREFIX);
}

function trimSkillContent(content: string, maxChars: number) {
  return content.replace(/\s+/g, ' ').trim().slice(0, maxChars);
}

function prioritizeSkillResults<T extends { sourceUri?: string }>(agentId: string, results: T[]) {
  const agentPrefix = `memory/agents/${agentId}/skills/`;
  return [...results].sort((left, right) => {
    const leftRank = left.sourceUri?.startsWith(agentPrefix) ? 0 : 1;
    const rightRank = right.sourceUri?.startsWith(agentPrefix) ? 0 : 1;
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    return (left.sourceUri ?? '').localeCompare(right.sourceUri ?? '');
  });
}

export async function syncAgentSkillDocuments(agentId: string, settings: ApiServerSettings) {
  const fileStore = createAgentMemoryApiFileStore(settings);
  if (!fileStore) {
    return { changed: 0, deleted: 0, total: 0 };
  }

  const prefix = createAgentSkillPrefix(agentId);
  const paths = (await fileStore.listPaths(prefix))
    .filter((path) => path.toLowerCase().endsWith('.md'))
    .sort((left, right) => left.localeCompare(right));

  const syncedAt = new Date().toISOString();
  const records = (
    await Promise.all(
      paths.map(async (path) => {
        const content = await fileStore.readText(path);
        if (typeof content !== 'string') {
          return null;
        }
        return createPathScopedKnowledgeRecord('agent_skill', path, content, { syncedAt });
      }),
    )
  ).filter((record): record is NonNullable<typeof record> => Boolean(record));

  const changed = await syncKnowledgeDocuments(records, { skipEmbeddings: true });
  const validIds = new Set(records.map((record) => record.id));
  const staleIds = (await getDocuments())
    .filter((document) => isManagedAgentSkillId(document.id))
    .filter((document) => document.sourceUri?.startsWith(`${prefix}/`))
    .filter((document) => !validIds.has(document.id))
    .map((document) => document.id);

  for (const id of staleIds) {
    await deleteDocument(id);
  }

  return {
    changed,
    deleted: staleIds.length,
    total: records.length,
  };
}

export async function getRelevantSkillContext(
  agentId: string,
  query: string,
  options: { maxResults?: number; maxChars?: number } = {},
) {
  const results = await searchKnowledgeDocuments(query, {
    maxResults: options.maxResults ?? 4,
    sourceTypes: ['skill_doc'],
    sourceUriPrefixes: [createAgentSkillPrefix(agentId), SHARED_SKILL_PREFIX],
  });
  const prioritizedResults = prioritizeSkillResults(agentId, results);

  if (prioritizedResults.length === 0) {
    return '';
  }

  const lines = prioritizedResults.map((result, index) => {
    const scope = result.sourceUri?.startsWith(`memory/agents/${agentId}/skills/`) ? 'agent' : 'shared';
    return [
      `${index + 1}. [${scope}] ${result.sourceUri ?? result.title}`,
      `Title: ${result.title}`,
      `Excerpt: ${trimSkillContent(result.content, options.maxChars ?? 360)}`,
    ].join('\n');
  });

  return [
    'Relevant local skills:',
    'If one of these skills directly fits the task, follow its workflow and constraints before improvising.',
    ...lines,
  ].join('\n\n');
}
