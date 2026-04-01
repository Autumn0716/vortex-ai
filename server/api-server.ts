import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createNightlyMemoryArchiveScheduler } from './nightly-memory-archive';

export interface FlowAgentApiServerOptions {
  authToken?: string;
  rootDir?: string;
  nightlyArchiveNow?: () => string | Date;
}

function normalizeRelativePath(input: string) {
  const normalized = input.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/').trim();
  if (!normalized) {
    throw new Error('Path is required.');
  }

  const segments = normalized.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('Invalid path.');
  }

  if (!normalized.startsWith('memory/agents/')) {
    throw new Error('Only memory/agents paths are allowed.');
  }

  return normalized;
}

export function resolveAllowedPath(rootDir: string, input: string, options: { allowDirectory?: boolean } = {}) {
  const normalizedRootDir = path.resolve(rootDir);
  const memoryRootDir = path.resolve(normalizedRootDir, 'memory/agents');
  const relativePath = normalizeRelativePath(input);
  if (!options.allowDirectory && !relativePath.endsWith('.md')) {
    throw new Error('Only Markdown memory files are allowed.');
  }
  const absolutePath = path.resolve(normalizedRootDir, relativePath);
  const allowedPrefix = `${memoryRootDir}${path.sep}`;

  if (absolutePath !== memoryRootDir && !absolutePath.startsWith(allowedPrefix)) {
    throw new Error('Path escapes the allowed memory root.');
  }

  return {
    relativePath,
    absolutePath,
  };
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

function applyCors(app: Express) {
  app.use((request: Request, response: Response, next: NextFunction) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    response.setHeader('Access-Control-Allow-Methods', 'GET, PUT, DELETE, OPTIONS');

    if (request.method === 'OPTIONS') {
      response.status(204).end();
      return;
    }

    next();
  });
}

function applyAuth(app: Express, authToken: string) {
  app.use((request: Request, response: Response, next: NextFunction) => {
    if (!authToken) {
      next();
      return;
    }

    const header = request.header('Authorization') ?? '';
    const expected = `Bearer ${authToken}`;
    if (header !== expected) {
      response.status(401).json({ error: 'Unauthorized.' });
      return;
    }

    next();
  });
}

export function createFlowAgentApiServer(options: FlowAgentApiServerOptions = {}) {
  const rootDir = path.resolve(options.rootDir ?? process.env.FLOWAGENT_PROJECT_ROOT ?? process.cwd());
  const authToken = (options.authToken ?? process.env.FLOWAGENT_API_TOKEN ?? '').trim();
  const memoryRootDir = path.resolve(rootDir, 'memory/agents');
  const nightlyArchiveScheduler = createNightlyMemoryArchiveScheduler({
    rootDir,
    now: options.nightlyArchiveNow,
  });
  const nightlyArchiveReady = nightlyArchiveScheduler.start();
  const app = express();

  app.use(express.json({ limit: '2mb' }));
  applyCors(app);
  applyAuth(app, authToken);

  app.get('/health', async (_request, response) => {
    const nightlyArchive = await nightlyArchiveScheduler.getStatus();
    response.json({
      ok: true,
      rootDir,
      nightlyArchive: {
        enabled: nightlyArchive.settings.enabled,
        time: nightlyArchive.settings.time,
        running: nightlyArchive.running,
        nextRunAt: nightlyArchive.nextRunAt,
        catchUpDue: nightlyArchive.catchUpDue,
        lastSuccessfulRunAt: nightlyArchive.state.lastSuccessfulRunAt,
        lastAttemptedRunAt: nightlyArchive.state.lastAttemptedRunAt,
        lastRunSummary: nightlyArchive.state.lastRunSummary
          ? {
              processedAgents: nightlyArchive.state.lastRunSummary.processedAgents,
              successfulAgents: nightlyArchive.state.lastRunSummary.successfulAgents,
              failedAgents: nightlyArchive.state.lastRunSummary.failedAgents,
              failures: nightlyArchive.state.lastRunSummary.failures,
            }
          : null,
      },
    });
  });

  app.get('/api/nightly-archive', async (_request, response) => {
    try {
      response.json(await nightlyArchiveScheduler.getStatus());
    } catch (error) {
      response.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to read nightly archive status.',
      });
    }
  });

  app.put('/api/nightly-archive', async (request, response) => {
    try {
      const nextSettings = await nightlyArchiveScheduler.updateSettings({
        enabled: typeof request.body?.enabled === 'boolean' ? request.body.enabled : undefined,
        time: typeof request.body?.time === 'string' ? request.body.time : undefined,
      });
      response.json(nextSettings);
    } catch (error) {
      response.status(400).json({
        error: error instanceof Error ? error.message : 'Failed to update nightly archive settings.',
      });
    }
  });

  app.get('/api/memory/paths', async (request, response) => {
    try {
      const prefix = String(request.query.prefix ?? '');
      const { relativePath, absolutePath } = resolveAllowedPath(rootDir, prefix, { allowDirectory: true });
      const stat = await fs.stat(absolutePath).catch(() => null);

      if (!stat) {
        response.json({ paths: [] });
        return;
      }

      if (stat.isFile()) {
        response.json({ paths: [relativePath] });
        return;
      }

      const files = await walkDirectory(absolutePath);
      const paths = files
        .map((filePath) => path.relative(rootDir, filePath).replace(/\\/g, '/'))
        .filter((filePath) => filePath.startsWith(relativePath))
        .filter((filePath) => filePath.endsWith('.md'))
        .sort();

      response.json({ paths });
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : 'Failed to list memory paths.' });
    }
  });

  app.get('/api/memory/file', async (request, response) => {
    try {
      const targetPath = String(request.query.path ?? '');
      const { absolutePath } = resolveAllowedPath(rootDir, targetPath);
      const content = await fs.readFile(absolutePath, 'utf8').catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') {
          return null;
        }
        throw error;
      });

      if (content === null) {
        response.status(404).json({ error: 'Memory file not found.' });
        return;
      }

      response.json({ content });
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : 'Failed to read memory file.' });
    }
  });

  app.put('/api/memory/file', async (request, response) => {
    try {
      const targetPath = String(request.body?.path ?? '');
      if (typeof request.body?.content !== 'string') {
        response.status(400).json({ error: 'Memory file content must be a string.' });
        return;
      }

      const content = request.body.content;
      const { absolutePath } = resolveAllowedPath(rootDir, targetPath);

      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, content, 'utf8');

      response.json({ ok: true });
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : 'Failed to write memory file.' });
    }
  });

  app.delete('/api/memory/file', async (request, response) => {
    try {
      const targetPath = String(request.query.path ?? '');
      const { absolutePath } = resolveAllowedPath(rootDir, targetPath);
      await fs.unlink(absolutePath).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') {
          return;
        }
        throw error;
      });
      response.json({ ok: true });
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : 'Failed to delete memory file.' });
    }
  });

  return {
    app,
    rootDir,
    memoryRootDir,
    nightlyArchiveScheduler,
    nightlyArchiveReady,
  };
}

async function startServer() {
  const port = Number(process.env.FLOWAGENT_API_PORT ?? 3850);
  const host = process.env.FLOWAGENT_API_HOST ?? '127.0.0.1';
  const { app, memoryRootDir, nightlyArchiveReady } = createFlowAgentApiServer();
  await nightlyArchiveReady;

  app.listen(port, host, () => {
    console.log(`FlowAgent API server listening on http://${host}:${port}`);
    console.log(`Memory root: ${memoryRootDir}`);
  });
}

const entryFile = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entryFile && entryFile === fileURLToPath(import.meta.url)) {
  startServer().catch((error) => {
    console.error('Failed to start FlowAgent API server:', error);
    process.exitCode = 1;
  });
}
