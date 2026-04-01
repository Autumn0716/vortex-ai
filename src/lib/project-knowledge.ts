import { classifyKnowledgeDocument } from './knowledge-document-model';
import { syncKnowledgeDocuments } from './db';

const PROJECT_MARKDOWN_DOCUMENTS = import.meta.glob(
  ['../../README.md', '../../todo-list.md', '../../docs/**/*.md', '../../skills.md', '../../skills/**/*.md'],
  {
    eager: true,
    query: '?raw',
    import: 'default',
  },
) as Record<string, string>;

function toDocumentTitle(path: string) {
  const segments = path.split('/');
  return segments[segments.length - 1] ?? path;
}

function buildDocumentId(path: string) {
  return `bundled_${path.replace(/[^a-zA-Z0-9]+/g, '_')}`;
}

export async function syncBundledKnowledgeDocuments() {
  const records = Object.entries(PROJECT_MARKDOWN_DOCUMENTS).map(([path, content]) => {
    const title = toDocumentTitle(path);
    const identity = classifyKnowledgeDocument({ title, sourceUri: path });

    return {
      id: buildDocumentId(path),
      title,
      content,
      sourceType: identity.sourceType,
      sourceUri: path,
      tags: identity.tags,
      syncedAt: new Date().toISOString(),
    };
  });

  return syncKnowledgeDocuments(records);
}
