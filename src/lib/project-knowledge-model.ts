import { classifyKnowledgeDocument } from './knowledge-document-model';

export const PROJECT_KNOWLEDGE_ROOT_FILES = ['README.md', 'todo-list.md', 'skills.md'] as const;
export const PROJECT_KNOWLEDGE_ROOT_DIRECTORIES = ['docs', 'skills'] as const;

export interface ProjectKnowledgeRecord {
  id: string;
  title: string;
  content: string;
  sourceType: ReturnType<typeof classifyKnowledgeDocument>['sourceType'];
  sourceUri: string;
  tags: string[];
  syncedAt: string;
}

export function normalizeProjectKnowledgePath(input: string) {
  return input
    .replace(/\\/g, '/')
    .replace(/^(\.\/)+/, '')
    .replace(/^(\.\.\/)+/, '')
    .replace(/^\/+/, '')
    .trim();
}

export function isProjectKnowledgePath(path: string) {
  const normalized = normalizeProjectKnowledgePath(path).toLowerCase();
  if (!normalized.endsWith('.md')) {
    return false;
  }

  if (PROJECT_KNOWLEDGE_ROOT_FILES.some((file) => file.toLowerCase() === normalized)) {
    return true;
  }

  return PROJECT_KNOWLEDGE_ROOT_DIRECTORIES.some((directory) =>
    normalized.startsWith(`${directory.toLowerCase()}/`),
  );
}

export function toProjectKnowledgeTitle(path: string) {
  const normalized = normalizeProjectKnowledgePath(path);
  const segments = normalized.split('/');
  return segments[segments.length - 1] ?? normalized;
}

export function buildPathScopedKnowledgeDocumentId(scope: string, path: string) {
  const normalizedScope = scope.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_') || 'knowledge';
  return `${normalizedScope}_${normalizeProjectKnowledgePath(path).replace(/[^a-zA-Z0-9]+/g, '_')}`;
}

export function buildProjectKnowledgeDocumentId(path: string) {
  return buildPathScopedKnowledgeDocumentId('project', path);
}

export function createPathScopedKnowledgeRecord(
  scope: string,
  path: string,
  content: string,
  options: { syncedAt?: string } = {},
): ProjectKnowledgeRecord {
  const sourceUri = normalizeProjectKnowledgePath(path);
  const title = toProjectKnowledgeTitle(sourceUri);
  const identity = classifyKnowledgeDocument({ title, sourceUri });

  return {
    id: buildPathScopedKnowledgeDocumentId(scope, sourceUri),
    title,
    content,
    sourceType: identity.sourceType,
    sourceUri,
    tags: identity.tags,
    syncedAt: options.syncedAt ?? new Date().toISOString(),
  };
}

export function createProjectKnowledgeRecord(
  path: string,
  content: string,
  options: { syncedAt?: string } = {},
) {
  return createPathScopedKnowledgeRecord('project', path, content, options);
}
