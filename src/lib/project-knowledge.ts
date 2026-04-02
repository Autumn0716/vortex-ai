import type { ApiServerSettings } from './agent/config';
import { deleteDocument, getDocuments, syncKnowledgeDocuments } from './db';
import { getProjectKnowledgeSnapshot } from './project-knowledge-api';
import {
  buildPathScopedKnowledgeDocumentId,
  createProjectKnowledgeRecord,
  normalizeProjectKnowledgePath,
  type ProjectKnowledgeRecord,
} from './project-knowledge-model';

const PROJECT_MARKDOWN_DOCUMENTS = import.meta.glob(
  ['../../README.md', '../../todo-list.md', '../../docs/**/*.md', '../../skills.md', '../../skills/**/*.md'],
  {
    eager: true,
    query: '?raw',
    import: 'default',
  },
) as Record<string, string>;

function isManagedProjectKnowledgeId(id: string) {
  return id.startsWith('project_') || id.startsWith('bundled_');
}

async function pruneStaleManagedProjectKnowledge(validRecords: ProjectKnowledgeRecord[]) {
  const validIds = new Set(validRecords.map((record) => record.id));
  const existing = await getDocuments();
  const staleIds = existing
    .filter((document) => isManagedProjectKnowledgeId(document.id))
    .filter((document) => !validIds.has(document.id))
    .map((document) => document.id);

  for (const id of staleIds) {
    await deleteDocument(id);
  }

  return staleIds.length;
}

async function syncManagedProjectKnowledge(records: ProjectKnowledgeRecord[]) {
  const changed = await syncKnowledgeDocuments(records, { skipEmbeddings: true });
  const deleted = await pruneStaleManagedProjectKnowledge(records);
  return {
    changed,
    deleted,
    total: records.length,
  };
}

function buildBundledKnowledgeRecords() {
  return Object.entries(PROJECT_MARKDOWN_DOCUMENTS).map(([path, content]) =>
    createProjectKnowledgeRecord(normalizeProjectKnowledgePath(path), content),
  );
}

export async function syncBundledKnowledgeDocuments() {
  return syncManagedProjectKnowledge(buildBundledKnowledgeRecords());
}

export async function syncProjectKnowledgeDocuments(settings?: ApiServerSettings | null) {
  if (settings?.enabled) {
    try {
      const snapshot = await getProjectKnowledgeSnapshot(settings);
      if (snapshot?.documents?.length) {
        return {
          ...(await syncManagedProjectKnowledge(snapshot.documents)),
          version: snapshot.version,
          source: 'host' as const,
        };
      }
    } catch (error) {
      console.warn('Host-backed project knowledge sync failed, falling back to bundled markdown:', error);
    }
  }

  return {
    ...(await syncBundledKnowledgeDocuments()),
    version: buildPathScopedKnowledgeDocumentId('project', 'bundled'),
    source: 'bundled' as const,
  };
}
