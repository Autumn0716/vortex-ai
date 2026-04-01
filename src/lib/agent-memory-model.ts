export type MemoryScope = 'global' | 'daily' | 'session';
export type MemorySourceType = 'manual' | 'conversation_log' | 'promotion';
export type MemoryTier = 'hot' | 'warm' | 'cold';

export interface MemoryContextDocument {
  id: string;
  title: string;
  content: string;
  memoryScope: MemoryScope;
  sourceType: MemorySourceType;
  importanceScore: number;
  updatedAt: string;
}

const DAY_IN_MS = 24 * 60 * 60 * 1000;

function normalizeMemoryText(content: string) {
  return content.replace(/\s+/g, ' ').trim();
}

export function resolveMemoryTier(updatedAt: string, now = new Date().toISOString()): MemoryTier {
  const ageMs = Math.max(0, new Date(now).getTime() - new Date(updatedAt).getTime());
  const ageDays = ageMs / DAY_IN_MS;

  if (ageDays <= 2) {
    return 'hot';
  }
  if (ageDays <= 15) {
    return 'warm';
  }
  return 'cold';
}

export function shouldPromoteMemory(content: string, role: 'user' | 'assistant' | 'system' | 'tool'): boolean {
  if (role !== 'user') {
    return false;
  }

  const normalized = normalizeMemoryText(content).toLowerCase();
  if (!normalized) {
    return false;
  }

  return /(记住|remember|长期记忆|长期保存|偏好|默认|总是|请始终|以后都|always|preference)/i.test(normalized);
}

export function scoreMemoryImportance(content: string, sourceType: MemorySourceType): number {
  const normalized = normalizeMemoryText(content).toLowerCase();

  if (sourceType === 'promotion' || /(记住|remember|默认|偏好|总是|请始终|重要决策|核心身份)/i.test(normalized)) {
    return 5;
  }
  if (/(deadline|due|todo|待办|风险|阻塞|urgent|紧急|决策)/i.test(normalized)) {
    return 4;
  }
  if (sourceType === 'conversation_log') {
    return 3;
  }
  return 2;
}

export function buildConversationMemoryEntry(input: {
  topicTitle: string;
  authorName: string;
  createdAt: string;
  content: string;
}): string {
  const timestamp = new Date(input.createdAt);
  const hh = `${timestamp.getHours()}`.padStart(2, '0');
  const mm = `${timestamp.getMinutes()}`.padStart(2, '0');
  return `- [${hh}:${mm}] ${input.topicTitle} · ${input.authorName}: ${normalizeMemoryText(input.content)}`;
}

export function buildPromotionFingerprint(content: string): string {
  const normalized = normalizeMemoryText(content)
    .toLowerCase()
    .replace(/^(记住|remember)\s*[:：-]?\s*/i, '');
  let hash = 5381;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = (hash * 33) ^ normalized.charCodeAt(index);
  }
  return `memory_${(hash >>> 0).toString(36)}`;
}

export function buildMemoryPromotionTitle(content: string): string {
  return (
    normalizeMemoryText(content)
      .replace(/^(记住|remember)\s*[:：-]?\s*/i, '')
      .slice(0, 64)
      .trim() || 'Promoted Memory'
  );
}

function renderMemoryLine(document: MemoryContextDocument, maxLength: number) {
  const preview = normalizeMemoryText(document.content).slice(0, maxLength);
  return `- ${document.title}: ${preview}`;
}

export function formatLayeredMemoryContext(
  documents: MemoryContextDocument[],
  options: { now?: string } = {},
): string {
  if (documents.length === 0) {
    return '';
  }

  const now = options.now ?? new Date().toISOString();
  const globalDocs = documents
    .filter((document) => document.memoryScope === 'global')
    .sort((left, right) => right.importanceScore - left.importanceScore || right.updatedAt.localeCompare(left.updatedAt));
  const tieredDocs = documents.filter((document) => document.memoryScope !== 'global');
  const hotDocs = tieredDocs.filter((document) => resolveMemoryTier(document.updatedAt, now) === 'hot');
  const warmDocs = tieredDocs.filter((document) => resolveMemoryTier(document.updatedAt, now) === 'warm');
  const coldDocs = tieredDocs.filter((document) => resolveMemoryTier(document.updatedAt, now) === 'cold');

  const sections = [
    globalDocs.length > 0
      ? `Long-term memory:\n${globalDocs.slice(0, 6).map((document) => renderMemoryLine(document, 240)).join('\n')}`
      : '',
    hotDocs.length > 0
      ? `Hot memory:\n${hotDocs.slice(0, 4).map((document) => renderMemoryLine(document, 320)).join('\n')}`
      : '',
    warmDocs.length > 0
      ? `Warm memory:\n${warmDocs.slice(0, 3).map((document) => renderMemoryLine(document, 180)).join('\n')}`
      : '',
    coldDocs.length > 0
      ? `Cold memory:\n${coldDocs.slice(0, 2).map((document) => renderMemoryLine(document, 120)).join('\n')}`
      : '',
  ].filter(Boolean);

  return sections.join('\n\n');
}
