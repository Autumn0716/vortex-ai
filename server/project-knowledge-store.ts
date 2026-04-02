import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  PROJECT_KNOWLEDGE_ROOT_DIRECTORIES,
  PROJECT_KNOWLEDGE_ROOT_FILES,
  createProjectKnowledgeRecord,
  normalizeProjectKnowledgePath,
  type ProjectKnowledgeRecord,
} from '../src/lib/project-knowledge-model';

export interface ProjectKnowledgeStatus {
  version: string;
  documentCount: number;
  paths: string[];
}

export interface ProjectKnowledgeSnapshot extends ProjectKnowledgeStatus {
  documents: ProjectKnowledgeRecord[];
}

async function walkDirectory(directoryPath: string): Promise<string[]> {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const nextPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkDirectory(nextPath)));
      continue;
    }
    files.push(nextPath);
  }

  return files;
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
