export type KnowledgeDocumentSourceType =
  | 'user_upload'
  | 'workspace_doc'
  | 'code_doc'
  | 'skill_doc'
  | 'system_note';

export interface KnowledgeDocumentIdentityInput {
  title: string;
  sourceUri?: string;
}

export interface KnowledgeDocumentIdentity {
  sourceType: KnowledgeDocumentSourceType;
  tags: string[];
}

export function normalizeKnowledgeTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right),
  );
}

export function classifyKnowledgeDocument(
  input: KnowledgeDocumentIdentityInput,
): KnowledgeDocumentIdentity {
  const title = input.title.trim().toLowerCase();
  const sourceUri = input.sourceUri?.trim().toLowerCase() ?? '';
  const combined = `${title} ${sourceUri}`;

  if (
    title === 'skill.md' ||
    title === 'skills.md' ||
    sourceUri.includes('/skills/') ||
    sourceUri.includes('\\skills\\') ||
    sourceUri.endsWith('/skill.md') ||
    sourceUri.endsWith('/skills.md')
  ) {
    return {
      sourceType: 'skill_doc',
      tags: normalizeKnowledgeTags(['knowledge', 'skill']),
    };
  }

  if (
    combined.includes('/docs/') ||
    combined.endsWith('readme.md') ||
    combined.endsWith('todo-list.md')
  ) {
    return {
      sourceType: 'workspace_doc',
      tags: normalizeKnowledgeTags(['knowledge', 'workspace']),
    };
  }

  if (/(\.ts|\.tsx|\.py|\.go)$/.test(sourceUri) && (sourceUri.startsWith('src/') || sourceUri.includes('/src/'))) {
    const languageTag = sourceUri.endsWith('.py')
      ? 'python'
      : sourceUri.endsWith('.go')
        ? 'go'
        : 'typescript';
    return {
      sourceType: 'code_doc',
      tags: normalizeKnowledgeTags(['code', 'knowledge', languageTag, 'workspace']),
    };
  }

  return {
    sourceType: 'user_upload',
    tags: normalizeKnowledgeTags(['knowledge']),
  };
}
