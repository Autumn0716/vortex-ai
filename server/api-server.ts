import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { mkdirSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readProjectConfig, writeProjectConfig } from './config-store';
import { inspectOfficialModelMetadata, MODEL_INSPECTOR_RESOLVER_VERSION } from './model-inspector';
import {
  listStoredModelMetadata,
  patchStoredModelMetadata,
  readStoredModelMetadata,
  writeStoredModelMetadata,
} from './model-metadata-store';
import { createNightlyMemoryArchiveScheduler } from './nightly-memory-archive';
import {
  createProjectKnowledgeWatcher,
  readProjectKnowledgeSnapshot,
} from './project-knowledge-store';
import { walkDirectory } from './lib/fs-utils';

export interface FlowAgentApiServerOptions {
  authToken?: string;
  rootDir?: string;
  nightlyArchiveNow?: () => string | Date;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
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

function applyCors(app: Express) {
  app.use((request: Request, response: Response, next: NextFunction) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    response.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, OPTIONS');

    if (request.method === 'OPTIONS') {
      response.status(204).end();
      return;
    }

    next();
  });
}

function sendApiError(response: Response, status: number, errorCode: string, message: string) {
  response.status(status).json({
    error: message,
    error_code: errorCode,
  });
}

function isModelMetadataStoreFailure(error: unknown) {
  return error instanceof Error && error.message.includes('Failed to read model metadata store at ');
}

function applyAuth(app: Express, authToken: string) {
  app.use((request: Request, response: Response, next: NextFunction) => {
    if (!authToken) {
      next();
      return;
    }

    const header = request.header('Authorization') ?? '';
    const expected = `Bearer ${authToken}`;
    const queryToken = String(request.query.authToken ?? '').trim();
    if (header !== expected && queryToken !== authToken) {
      sendApiError(response, 401, 'AUTH_UNAUTHORIZED', 'Unauthorized.');
      return;
    }

    next();
  });
}

function applyRequestLogging(app: Express, logger: Pick<Console, 'info'>) {
  app.use((request: Request, response: Response, next: NextFunction) => {
    const startedAt = Date.now();
    response.on('finish', () => {
      logger.info(`[api] ${request.method} ${request.path} ${response.statusCode} ${Date.now() - startedAt}ms`);
    });
    next();
  });
}

export function createFlowAgentApiServer(options: FlowAgentApiServerOptions = {}) {
  const rootDir = path.resolve(options.rootDir ?? process.env.FLOWAGENT_PROJECT_ROOT ?? process.cwd());
  const authToken = (options.authToken ?? process.env.FLOWAGENT_API_TOKEN ?? '').trim();
  const logger = options.logger ?? console;
  const memoryRootDir = path.resolve(rootDir, 'memory/agents');
  mkdirSync(memoryRootDir, { recursive: true });
  const nightlyArchiveScheduler = createNightlyMemoryArchiveScheduler({
    rootDir,
    now: options.nightlyArchiveNow,
  });
  const nightlyArchiveReady = nightlyArchiveScheduler.start();
  const projectKnowledgeWatcher = createProjectKnowledgeWatcher(rootDir);
  const projectKnowledgeReady = projectKnowledgeWatcher.ready;
  const app = express();

  app.use(express.json({ limit: '2mb' }));
  applyCors(app);
  applyAuth(app, authToken);
  applyRequestLogging(app, logger);

  app.get('/health', async (_request, response) => {
    const nightlyArchive = await nightlyArchiveScheduler.getStatus();
    response.json({
      ok: true,
      rootDir,
      nightlyArchive: {
        enabled: nightlyArchive.settings.enabled,
        time: nightlyArchive.settings.time,
        useLlmScoring: nightlyArchive.settings.useLlmScoring,
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
              promotedCount: nightlyArchive.state.lastRunSummary.promotedCount,
              llmScoredCount: nightlyArchive.state.lastRunSummary.llmScoredCount,
              ruleFallbackCount: nightlyArchive.state.lastRunSummary.ruleFallbackCount,
            }
          : null,
      },
    });
  });

  app.get('/api/config', async (_request, response) => {
    try {
      response.json(await readProjectConfig(rootDir));
    } catch (error) {
      sendApiError(
        response,
        500,
        'CONFIG_READ_FAILED',
        error instanceof Error ? error.message : 'Failed to read project config.',
      );
    }
  });

  app.get('/api/model-inspector', async (request, response) => {
    try {
      const providerId = String(request.query.providerId ?? '').trim();
      const providerName = String(request.query.providerName ?? '').trim();
      const model = String(request.query.model ?? '').trim();
      const refresh = String(request.query.refresh ?? '').trim() === 'true';
      if (!providerId || !providerName || !model) {
        sendApiError(response, 400, 'MODEL_INSPECTOR_INVALID_REQUEST', 'providerId, providerName and model are required.');
        return;
      }
      if (!refresh) {
        const cached = await readStoredModelMetadata(rootDir, providerId, model);
        if (cached && cached.resolverVersion === MODEL_INSPECTOR_RESOLVER_VERSION) {
          response.json(cached);
          return;
        }
      }

      const detected = await inspectOfficialModelMetadata(providerName, model);
      response.json(await writeStoredModelMetadata(rootDir, providerId, model, detected));
    } catch (error) {
      sendApiError(
        response,
        500,
        'MODEL_INSPECTOR_FAILED',
        error instanceof Error ? error.message : 'Failed to inspect official model metadata.',
      );
    }
  });

  app.get('/api/model-metadata', async (request, response) => {
    try {
      const providerId = String(request.query.providerId ?? '').trim();
      if (!providerId) {
        sendApiError(response, 400, 'MODEL_METADATA_INVALID_REQUEST', 'providerId is required.');
        return;
      }
      response.json({
        entries: await listStoredModelMetadata(rootDir, providerId),
      });
    } catch (error) {
      sendApiError(
        response,
        500,
        'MODEL_METADATA_READ_FAILED',
        error instanceof Error ? error.message : 'Failed to read stored model metadata.',
      );
    }
  });

  app.put('/api/model-metadata', async (request, response) => {
    try {
      const providerId = String(request.body?.providerId ?? '').trim();
      const providerName = String(request.body?.providerName ?? '').trim();
      const model = String(request.body?.model ?? '').trim();
      if (!providerId || !providerName || !model) {
        sendApiError(response, 400, 'MODEL_METADATA_INVALID_REQUEST', 'providerId, providerName and model are required.');
        return;
      }
      response.json(
        await patchStoredModelMetadata(rootDir, providerId, providerName, model, request.body?.metadata ?? {}),
      );
    } catch (error) {
      sendApiError(
        response,
        isModelMetadataStoreFailure(error) ? 500 : 400,
        'MODEL_METADATA_WRITE_FAILED',
        error instanceof Error ? error.message : 'Failed to write stored model metadata.',
      );
    }
  });

  app.put('/api/config', async (request, response) => {
    try {
      response.json(await writeProjectConfig(rootDir, request.body ?? {}));
    } catch (error) {
      sendApiError(
        response,
        400,
        'CONFIG_WRITE_FAILED',
        error instanceof Error ? error.message : 'Failed to write project config.',
      );
    }
  });

  app.get('/api/nightly-archive', async (_request, response) => {
    try {
      response.json(await nightlyArchiveScheduler.getStatus());
    } catch (error) {
      sendApiError(
        response,
        500,
        'NIGHTLY_ARCHIVE_STATUS_FAILED',
        error instanceof Error ? error.message : 'Failed to read nightly archive status.',
      );
    }
  });

  app.put('/api/nightly-archive', async (request, response) => {
    try {
      const nextSettings = await nightlyArchiveScheduler.updateSettings({
        enabled: typeof request.body?.enabled === 'boolean' ? request.body.enabled : undefined,
        time: typeof request.body?.time === 'string' ? request.body.time : undefined,
        useLlmScoring:
          typeof request.body?.useLlmScoring === 'boolean' ? request.body.useLlmScoring : undefined,
      });
      response.json(nextSettings);
    } catch (error) {
      sendApiError(
        response,
        400,
        'NIGHTLY_ARCHIVE_UPDATE_FAILED',
        error instanceof Error ? error.message : 'Failed to update nightly archive settings.',
      );
    }
  });

  app.post('/api/nightly-archive/run', async (_request, response) => {
    try {
      response.json(await nightlyArchiveScheduler.runNow('manual'));
    } catch (error) {
      sendApiError(
        response,
        500,
        'NIGHTLY_ARCHIVE_RUN_FAILED',
        error instanceof Error ? error.message : 'Failed to run nightly archive.',
      );
    }
  });

  app.get('/api/automations', async (_request, response) => {
    try {
      const nightlyArchive = await nightlyArchiveScheduler.getStatus();
      response.json({
        automations: [
          {
            id: 'nightly_archive',
            title: '记忆归档',
            description: '同步温冷层、执行长期记忆晋升，并可选调用 LLM 重要性评分。',
            enabled: nightlyArchive.settings.enabled,
            schedule: `每天 ${nightlyArchive.settings.time}`,
            running: nightlyArchive.running,
            nextRunAt: nightlyArchive.nextRunAt,
            lastRunSummary: nightlyArchive.state.lastRunSummary,
            capabilities: ['manual_run', 'scheduled_run', 'catch_up'],
          },
        ],
      });
    } catch (error) {
      sendApiError(
        response,
        500,
        'AUTOMATION_STATUS_FAILED',
        error instanceof Error ? error.message : 'Failed to read automation status.',
      );
    }
  });

  app.post('/api/automations/:id/run', async (request, response) => {
    try {
      if (request.params.id !== 'nightly_archive') {
        sendApiError(response, 404, 'AUTOMATION_NOT_FOUND', `Unknown automation: ${request.params.id}`);
        return;
      }
      response.json(await nightlyArchiveScheduler.runNow('manual'));
    } catch (error) {
      sendApiError(
        response,
        500,
        'AUTOMATION_RUN_FAILED',
        error instanceof Error ? error.message : 'Failed to run automation.',
      );
    }
  });

  app.get('/api/project-knowledge/status', async (_request, response) => {
    try {
      response.json(await projectKnowledgeWatcher.getStatus());
    } catch (error) {
      sendApiError(
        response,
        500,
        'PROJECT_KNOWLEDGE_STATUS_FAILED',
        error instanceof Error ? error.message : 'Failed to read project knowledge status.',
      );
    }
  });

  app.get('/api/project-knowledge/documents', async (_request, response) => {
    try {
      response.json(await readProjectKnowledgeSnapshot(rootDir));
    } catch (error) {
      sendApiError(
        response,
        500,
        'PROJECT_KNOWLEDGE_DOCUMENTS_FAILED',
        error instanceof Error ? error.message : 'Failed to read project knowledge documents.',
      );
    }
  });

  app.get('/api/project-knowledge/events', async (request, response) => {
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.flushHeaders?.();

    const unsubscribe = projectKnowledgeWatcher.subscribe((status) => {
      response.write(`event: project-knowledge\n`);
      response.write(`data: ${JSON.stringify(status)}\n\n`);
    });

    request.on('close', () => {
      unsubscribe();
      response.end();
    });
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
      sendApiError(
        response,
        400,
        'MEMORY_PATHS_FAILED',
        error instanceof Error ? error.message : 'Failed to list memory paths.',
      );
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
        sendApiError(response, 404, 'MEMORY_FILE_NOT_FOUND', 'Memory file not found.');
        return;
      }

      response.json({ content });
    } catch (error) {
      sendApiError(
        response,
        400,
        'MEMORY_FILE_READ_FAILED',
        error instanceof Error ? error.message : 'Failed to read memory file.',
      );
    }
  });

  app.put('/api/memory/file', async (request, response) => {
    try {
      const targetPath = String(request.body?.path ?? '');
      if (typeof request.body?.content !== 'string') {
        sendApiError(response, 400, 'MEMORY_FILE_INVALID_CONTENT', 'Memory file content must be a string.');
        return;
      }

      const content = request.body.content;
      const { absolutePath } = resolveAllowedPath(rootDir, targetPath);

      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, content, 'utf8');

      response.json({ ok: true });
    } catch (error) {
      sendApiError(
        response,
        400,
        'MEMORY_FILE_WRITE_FAILED',
        error instanceof Error ? error.message : 'Failed to write memory file.',
      );
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
      sendApiError(
        response,
        400,
        'MEMORY_FILE_DELETE_FAILED',
        error instanceof Error ? error.message : 'Failed to delete memory file.',
      );
    }
  });

  return {
    app,
    rootDir,
    memoryRootDir,
    nightlyArchiveScheduler,
    nightlyArchiveReady,
    projectKnowledgeWatcher,
    projectKnowledgeReady,
  };
}

async function startServer() {
  const port = Number(process.env.FLOWAGENT_API_PORT ?? 3850);
  const host = process.env.FLOWAGENT_API_HOST ?? '127.0.0.1';
  const { app, memoryRootDir, nightlyArchiveReady, projectKnowledgeReady } = createFlowAgentApiServer();
  await Promise.all([nightlyArchiveReady, projectKnowledgeReady]);

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
