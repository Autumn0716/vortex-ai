import { promises as fs } from 'node:fs';
import path from 'node:path';

import { readProjectConfig, writeProjectConfig } from './config-store';
import { walkDirectory } from './lib/fs-utils';
import type { AgentConfig } from '../src/lib/agent/config';

export interface FlowAgentPackageFile {
  path: string;
  content: string;
}

export interface FlowAgentPackage {
  format: 'flowagent.package';
  formatVersion: 1;
  exportedAt: string;
  agentSlug: string;
  config: AgentConfig;
  memoryFiles: FlowAgentPackageFile[];
  skillFiles: FlowAgentPackageFile[];
}

export interface ImportAgentPackageResult {
  agentSlug: string;
  memoryFileCount: number;
  skillFileCount: number;
  configImported: boolean;
}

function normalizeAgentSlug(input: string) {
  const normalized = input.trim().replace(/^agents\//, '');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(normalized)) {
    throw new Error('Agent slug must use letters, numbers, underscores, or hyphens.');
  }
  return normalized;
}

function assertSafePackagePath(filePath: string) {
  const normalized = filePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const segments = normalized.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`Invalid package file path: ${filePath}`);
  }
  return normalized;
}

async function readTextFiles(rootDir: string, relativeRoot: string, predicate: (filePath: string) => boolean) {
  const absoluteRoot = path.resolve(rootDir, relativeRoot);
  const stat = await fs.stat(absoluteRoot).catch(() => null);
  if (!stat) {
    return [];
  }
  const filePaths = stat.isFile() ? [absoluteRoot] : await walkDirectory(absoluteRoot);
  const files: FlowAgentPackageFile[] = [];

  for (const filePath of filePaths.sort((left, right) => left.localeCompare(right))) {
    const relativePath = path.relative(rootDir, filePath).replace(/\\/g, '/');
    if (!predicate(relativePath)) {
      continue;
    }
    files.push({
      path: relativePath,
      content: await fs.readFile(filePath, 'utf8'),
    });
  }

  return files;
}

export async function exportAgentPackage(input: {
  rootDir: string;
  agentSlug: string;
  now?: string;
}): Promise<FlowAgentPackage> {
  const rootDir = path.resolve(input.rootDir);
  const agentSlug = normalizeAgentSlug(input.agentSlug);
  const config = await readProjectConfig(rootDir);
  const memoryRoot = `memory/agents/${agentSlug}`;

  return {
    format: 'flowagent.package',
    formatVersion: 1,
    exportedAt: input.now ?? new Date().toISOString(),
    agentSlug,
    config,
    memoryFiles: await readTextFiles(rootDir, memoryRoot, (filePath) =>
      filePath.startsWith(`${memoryRoot}/`) && filePath.endsWith('.md'),
    ),
    skillFiles: await readTextFiles(rootDir, 'skills', (filePath) =>
      filePath.startsWith('skills/') && filePath.endsWith('.md'),
    ),
  };
}

export async function importAgentPackage(input: {
  rootDir: string;
  packageData: FlowAgentPackage;
  targetAgentSlug?: string;
  importConfig?: boolean;
}): Promise<ImportAgentPackageResult> {
  const rootDir = path.resolve(input.rootDir);
  const packageData = input.packageData;
  if (packageData?.format !== 'flowagent.package' || packageData.formatVersion !== 1) {
    throw new Error('Unsupported FlowAgent package format.');
  }

  const sourceAgentSlug = normalizeAgentSlug(packageData.agentSlug);
  const targetAgentSlug = normalizeAgentSlug(input.targetAgentSlug ?? sourceAgentSlug);
  let memoryFileCount = 0;
  let skillFileCount = 0;

  for (const file of packageData.memoryFiles ?? []) {
    const safePath = assertSafePackagePath(file.path);
    if (!safePath.startsWith(`memory/agents/${sourceAgentSlug}/`) || !safePath.endsWith('.md')) {
      throw new Error(`Invalid memory package path: ${file.path}`);
    }
    const targetPath = safePath.replace(`memory/agents/${sourceAgentSlug}/`, `memory/agents/${targetAgentSlug}/`);
    const absolutePath = path.resolve(rootDir, targetPath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, file.content, 'utf8');
    memoryFileCount += 1;
  }

  for (const file of packageData.skillFiles ?? []) {
    const safePath = assertSafePackagePath(file.path);
    if (!safePath.startsWith('skills/') || !safePath.endsWith('.md')) {
      throw new Error(`Invalid skill package path: ${file.path}`);
    }
    const absolutePath = path.resolve(rootDir, safePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, file.content, 'utf8');
    skillFileCount += 1;
  }

  if (input.importConfig) {
    await writeProjectConfig(rootDir, packageData.config);
  }

  return {
    agentSlug: targetAgentSlug,
    memoryFileCount,
    skillFileCount,
    configImported: Boolean(input.importConfig),
  };
}
