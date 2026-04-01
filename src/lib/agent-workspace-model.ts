export const DEFAULT_TOPIC_TITLE = 'New Topic';
export const DEFAULT_TOPIC_PREVIEW = 'No messages yet';

function slugifyName(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function buildAgentWorkspacePath(name: string): string {
  return `agents/${slugifyName(name) || 'agent'}`;
}

export function buildMigratedTopicTitle(
  title: string,
  agentName: string,
  hadMultipleLanes: boolean,
): string {
  const normalizedTitle = title.trim() || DEFAULT_TOPIC_TITLE;
  const normalizedAgentName = agentName.trim() || 'Agent';
  return hadMultipleLanes ? `${normalizedTitle} · ${normalizedAgentName}` : normalizedTitle;
}

export function formatTopicPreview(content: string): string {
  return content.replace(/\s+/g, ' ').trim() || DEFAULT_TOPIC_PREVIEW;
}

export function resolveActiveAgentId(
  storedAgentId: string | null | undefined,
  agentIds: string[],
): string | null {
  if (storedAgentId && agentIds.includes(storedAgentId)) {
    return storedAgentId;
  }

  return agentIds[0] ?? null;
}
