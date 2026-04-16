import { classifyKnowledgeDocument } from './knowledge-document-model';

export const PROJECT_KNOWLEDGE_ROOT_FILES = ['README.md', 'todo-list.md', 'skills.md'] as const;
export const PROJECT_KNOWLEDGE_ROOT_DIRECTORIES = ['docs', 'skills'] as const;
export const PROJECT_KNOWLEDGE_CODE_DIRECTORIES = ['src'] as const;
export const PROJECT_KNOWLEDGE_CODE_EXTENSIONS = ['.ts', '.tsx', '.py', '.go'] as const;

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

  if (normalized.endsWith('.md') && PROJECT_KNOWLEDGE_ROOT_FILES.some((file) => file.toLowerCase() === normalized)) {
    return true;
  }

  if (
    normalized.endsWith('.md') &&
    PROJECT_KNOWLEDGE_ROOT_DIRECTORIES.some((directory) =>
    normalized.startsWith(`${directory.toLowerCase()}/`),
    )
  ) {
    return true;
  }

  return (
    PROJECT_KNOWLEDGE_CODE_EXTENSIONS.some((extension) => normalized.endsWith(extension)) &&
    PROJECT_KNOWLEDGE_CODE_DIRECTORIES.some((directory) => normalized.startsWith(`${directory.toLowerCase()}/`))
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

function resolveCodeLanguage(path: string) {
  const normalized = normalizeProjectKnowledgePath(path).toLowerCase();
  if (normalized.endsWith('.py')) {
    return 'Python';
  }
  if (normalized.endsWith('.go')) {
    return 'Go';
  }
  if (normalized.endsWith('.tsx')) {
    return 'TSX';
  }
  return 'TypeScript';
}

function collectMatchedLines(content: string, patterns: RegExp[], limit: number) {
  const matches: string[] = [];
  content.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || matches.length >= limit) {
      return;
    }
    if (patterns.some((pattern) => pattern.test(trimmed))) {
      matches.push(`- L${index + 1}: ${trimmed.slice(0, 180)}`);
    }
  });
  return matches;
}

function extractCodeImports(path: string, content: string) {
  const language = resolveCodeLanguage(path);
  if (language === 'Python') {
    return collectMatchedLines(content, [/^(from\s+\S+\s+import\s+|import\s+\S+)/], 18);
  }
  if (language === 'Go') {
    return collectMatchedLines(content, [/^package\s+\w+/, /^import\s+/, /^"[^"]+"$/], 18);
  }
  return collectMatchedLines(content, [/^import\s+/, /^export\s+\*\s+from\s+/], 24);
}

function extractCodeSymbols(path: string, content: string) {
  const language = resolveCodeLanguage(path);
  if (language === 'Python') {
    return collectMatchedLines(content, [/^def\s+\w+\s*\(/, /^async\s+def\s+\w+\s*\(/, /^class\s+\w+/], 40);
  }
  if (language === 'Go') {
    return collectMatchedLines(content, [/^func\s+/, /^type\s+\w+\s+(struct|interface)/], 40);
  }
  return collectMatchedLines(
    content,
    [
      /^(export\s+)?(async\s+)?function\s+\w+/,
      /^(export\s+)?class\s+\w+/,
      /^(export\s+)?interface\s+\w+/,
      /^(export\s+)?type\s+\w+/,
      /^(export\s+)?const\s+\w+\s*=/,
      /^(export\s+)?const\s+\w+\s*:\s*/,
    ],
    48,
  );
}

export function buildCodeKnowledgeContent(path: string, content: string) {
  const sourceUri = normalizeProjectKnowledgePath(path);
  const imports = extractCodeImports(sourceUri, content);
  const symbols = extractCodeSymbols(sourceUri, content);
  const significantComments = collectMatchedLines(content, [/^\/\/\s*\w+/, /^\/\*\*/, /^#\s*\w+/], 10);
  const preview = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 40)
    .join('\n')
    .slice(0, 3000);

  return [
    `# Code Index: ${sourceUri}`,
    '',
    `Language: ${resolveCodeLanguage(sourceUri)}`,
    `Source: ${sourceUri}`,
    '',
    '## Symbols',
    symbols.length ? symbols.join('\n') : '- No top-level symbols detected.',
    '',
    '## Imports',
    imports.length ? imports.join('\n') : '- No imports detected.',
    '',
    '## Comments',
    significantComments.length ? significantComments.join('\n') : '- No leading comments detected.',
    '',
    '## Preview',
    '```',
    preview,
    '```',
  ].join('\n');
}

function isCodeKnowledgePath(path: string) {
  const normalized = normalizeProjectKnowledgePath(path).toLowerCase();
  return PROJECT_KNOWLEDGE_CODE_EXTENSIONS.some((extension) => normalized.endsWith(extension));
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
  const indexedContent = isCodeKnowledgePath(sourceUri) ? buildCodeKnowledgeContent(sourceUri, content) : content;

  return {
    id: buildPathScopedKnowledgeDocumentId(scope, sourceUri),
    title,
    content: indexedContent,
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
