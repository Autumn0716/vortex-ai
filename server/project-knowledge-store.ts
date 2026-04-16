import { createHash } from 'node:crypto';
import { promises as fs, watch, type FSWatcher } from 'node:fs';
import path from 'node:path';

import {
  PROJECT_KNOWLEDGE_ROOT_DIRECTORIES,
  PROJECT_KNOWLEDGE_ROOT_FILES,
  PROJECT_KNOWLEDGE_CODE_DIRECTORIES,
  PROJECT_KNOWLEDGE_CODE_EXTENSIONS,
  createProjectKnowledgeRecord,
  normalizeProjectKnowledgePath,
  type ProjectKnowledgeRecord,
} from '../src/lib/project-knowledge-model';
import { walkDirectory } from './lib/fs-utils';

export interface ProjectKnowledgeStatus {
  version: string;
  documentCount: number;
  paths: string[];
}

export interface ProjectKnowledgeSnapshot extends ProjectKnowledgeStatus {
  documents: ProjectKnowledgeRecord[];
}

export interface ProjectKnowledgeWatcher {
  ready: Promise<ProjectKnowledgeStatus>;
  getStatus: () => Promise<ProjectKnowledgeStatus>;
  subscribe: (listener: (status: ProjectKnowledgeStatus) => void) => () => void;
  stop: () => void;
}

async function collectProjectKnowledgePaths(rootDir: string) {
  const normalizedRoot = path.resolve(rootDir);
  const absolutePaths = new Set<string>();

  await Promise.all(
    PROJECT_KNOWLEDGE_ROOT_FILES.map(async (relativePath) => {
      const absolutePath = path.join(normalizedRoot, relativePath);
      const stat = await fs.stat(absolutePath).catch(() => null);
      if (stat?.isFile()) {
        absolutePaths.add(absolutePath);
      }
    }),
  );

  await Promise.all(
    PROJECT_KNOWLEDGE_ROOT_DIRECTORIES.map(async (relativePath) => {
      const absolutePath = path.join(normalizedRoot, relativePath);
      const stat = await fs.stat(absolutePath).catch(() => null);
      if (!stat?.isDirectory()) {
        return;
      }
      const files = await walkDirectory(absolutePath);
      files
        .filter((filePath) => filePath.toLowerCase().endsWith('.md'))
        .forEach((filePath) => absolutePaths.add(filePath));
    }),
  );

  await Promise.all(
    PROJECT_KNOWLEDGE_CODE_DIRECTORIES.map(async (relativePath) => {
      const absolutePath = path.join(normalizedRoot, relativePath);
      const stat = await fs.stat(absolutePath).catch(() => null);
      if (!stat?.isDirectory()) {
        return;
      }
      const files = await walkDirectory(absolutePath);
      files
        .filter((filePath) =>
          PROJECT_KNOWLEDGE_CODE_EXTENSIONS.some((extension) => filePath.toLowerCase().endsWith(extension)),
        )
        .forEach((filePath) => absolutePaths.add(filePath));
    }),
  );

  return [...absolutePaths]
    .map((absolutePath) => normalizeProjectKnowledgePath(path.relative(normalizedRoot, absolutePath)))
    .sort((left, right) => left.localeCompare(right));
}

async function buildProjectKnowledgeVersion(rootDir: string, relativePaths: string[]) {
  const hash = createHash('sha1');

  for (const relativePath of relativePaths) {
    const absolutePath = path.join(rootDir, relativePath);
    const stat = await fs.stat(absolutePath);
    hash.update(relativePath);
    hash.update(':');
    hash.update(String(stat.size));
    hash.update(':');
    hash.update(String(Math.trunc(stat.mtimeMs)));
    hash.update('|');
  }

  return hash.digest('hex');
}

export async function getProjectKnowledgeStatus(rootDir: string): Promise<ProjectKnowledgeStatus> {
  const relativePaths = await collectProjectKnowledgePaths(rootDir);
  return {
    version: await buildProjectKnowledgeVersion(rootDir, relativePaths),
    documentCount: relativePaths.length,
    paths: relativePaths,
  };
}

export async function readProjectKnowledgeSnapshot(rootDir: string): Promise<ProjectKnowledgeSnapshot> {
  const status = await getProjectKnowledgeStatus(rootDir);
  const documents = await Promise.all(
    status.paths.map(async (relativePath) =>
      createProjectKnowledgeRecord(
        relativePath,
        await fs.readFile(path.join(rootDir, relativePath), 'utf8'),
        { syncedAt: new Date().toISOString() },
      ),
    ),
  );

  return {
    ...status,
    documents,
  };
}

function sameStatus(left: ProjectKnowledgeStatus | null, right: ProjectKnowledgeStatus) {
  return Boolean(
    left &&
      left.version === right.version &&
      left.documentCount === right.documentCount &&
      JSON.stringify(left.paths) === JSON.stringify(right.paths),
  );
}

export function createProjectKnowledgeWatcher(rootDir: string): ProjectKnowledgeWatcher {
  const normalizedRoot = path.resolve(rootDir);
  const listeners = new Set<(status: ProjectKnowledgeStatus) => void>();
  const watchers = new Set<FSWatcher>();
  let cachedStatus: ProjectKnowledgeStatus | null = null;
  let refreshPromise: Promise<ProjectKnowledgeStatus> | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const emit = (status: ProjectKnowledgeStatus) => {
    listeners.forEach((listener) => {
      try {
        listener(status);
      } catch (error) {
        console.warn('Project knowledge watcher listener failed:', error);
      }
    });
  };

  const closeWatchers = () => {
    watchers.forEach((watcher) => watcher.close());
    watchers.clear();
  };

  const attachRecursiveWatch = (targetPath: string) => {
    const watcher = watch(
      targetPath,
      {
        recursive: true,
        persistent: false,
      },
      () => {
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }
        debounceTimer = setTimeout(() => {
          debounceTimer = null;
          void refresh();
        }, 120);
      },
    );
    watchers.add(watcher);
  };

  const refresh = async () => {
    if (refreshPromise) {
      return refreshPromise;
    }

    refreshPromise = (async () => {
      const nextStatus = await getProjectKnowledgeStatus(normalizedRoot);
      if (!sameStatus(cachedStatus, nextStatus)) {
        cachedStatus = nextStatus;
        emit(nextStatus);
      }
      return nextStatus;
    })();

    try {
      return await refreshPromise;
    } finally {
      refreshPromise = null;
    }
  };

  const ready = (async () => {
    closeWatchers();
    attachRecursiveWatch(normalizedRoot);
    return refresh();
  })();

  return {
    ready,
    getStatus: async () => cachedStatus ?? refresh(),
    subscribe(listener) {
      listeners.add(listener);
      void ready.then((status) => listener(status));
      return () => {
        listeners.delete(listener);
      };
    },
    stop() {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      closeWatchers();
      listeners.clear();
    },
  };
}
