import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import { createFlowAgentApiServer } from '../server/api-server';
import { listAgentMemoryFiles, writeAgentMemoryFile } from '../src/lib/agent-memory-api';
import {
  syncAgentMemoryLifecycleFromStore,
  type AgentMemoryFileStore,
  type AgentMemoryLifecycleResult,
} from '../src/lib/agent-memory-sync';

const tempRoots: string[] = [];

async function createTempRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'flowagent-lifecycle-'));
  tempRoots.push(root);
  return root;
}

async function startServer(rootDir: string) {
  const { app, nightlyArchiveReady, nightlyArchiveScheduler } = createFlowAgentApiServer({
    rootDir,
    authToken: '',
    nightlyArchiveNow: () => '2026-04-20T12:00:00.000Z',
  });
  await nightlyArchiveReady;
  const server = await new Promise<Server>((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    instance.on('error', reject);
  });
  const address = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      nightlyArchiveScheduler.stop();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

after(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
});

class InMemoryFileStore implements AgentMemoryFileStore {
  writes: string[] = [];
  deletes: string[] = [];

  constructor(private readonly files = new Map<string, string>()) {}

  async listPaths(prefix: string) {
    return [...this.files.keys()].filter((path) => path.startsWith(prefix)).sort();
  }

  async readText(path: string) {
    return this.files.get(path) ?? null;
  }

  async writeText(path: string, content: string) {
    this.writes.push(path);
    this.files.set(path, content);
  }

  async deleteText(path: string) {
    this.deletes.push(path);
    this.files.delete(path);
  }
}

class DeleteFailingFileStore extends InMemoryFileStore {
  constructor(
    files: Map<string, string>,
    private readonly failingDeletes: Set<string>,
  ) {
    super(files);
  }

  override async deleteText(path: string) {
    if (this.failingDeletes.has(path)) {
      throw new Error(`Cannot delete ${path}`);
    }

    await super.deleteText(path);
  }
}

class ReadOnlyLifecycleFileStore implements AgentMemoryFileStore {
  constructor(private readonly files = new Map<string, string>()) {}

  async listPaths(prefix: string) {
    return [...this.files.keys()].filter((path) => path.startsWith(prefix)).sort();
  }

  async readText(path: string) {
    return this.files.get(path) ?? null;
  }

  async writeText(path: string, content: string) {
    this.files.set(path, content);
  }
}

test('syncAgentMemoryLifecycleFromStore creates warm and cold surrogates from source daily files', async () => {
  const fileStore = new InMemoryFileStore(
    new Map([
      ['memory/agents/core/daily/2026-04-10.md', '- TODO 完成温层摘要'],
      ['memory/agents/core/daily/2026-03-01.md', '- TODO 保留冷层索引'],
    ]),
  );

  const result: AgentMemoryLifecycleResult = await syncAgentMemoryLifecycleFromStore({
    agentSlug: 'core',
    fileStore,
    now: '2026-04-20T12:00:00.000Z',
  });

  assert.deepEqual(result, {
    scannedCount: 2,
    warmUpdated: 1,
    coldUpdated: 1,
    skippedCount: 0,
    failures: [],
  });
  assert.match((await fileStore.readText('memory/agents/core/daily/2026-04-10.warm.md')) ?? '', /tier: "warm"/);
  assert.match((await fileStore.readText('memory/agents/core/daily/2026-03-01.cold.md')) ?? '', /tier: "cold"/);
});

test('syncAgentMemoryLifecycleFromStore falls back to rules when scoring callback fails', async () => {
  const fileStore = new InMemoryFileStore(
    new Map([['memory/agents/core/daily/2026-04-10.md', '- TODO 完成温层摘要']]),
  );

  const result = await syncAgentMemoryLifecycleFromStore({
    agentSlug: 'core',
    fileStore,
    now: '2026-04-20T12:00:00.000Z',
    scoreImportance: async () => {
      throw new Error('model unavailable');
    },
  });

  assert.deepEqual(result.scoring, {
    llmScoredCount: 0,
    ruleFallbackCount: 1,
  });
  const warm = await fileStore.readText('memory/agents/core/daily/2026-04-10.warm.md');
  assert.match(warm ?? '', /importanceSource: "rules"/);
  assert.match(warm ?? '', /validityHint: "stable"/);
  assert.match(warm ?? '', /transferability: "medium"/);
});

test('syncAgentMemoryLifecycleFromStore is idempotent when source markdown is unchanged', async () => {
  const fileStore = new InMemoryFileStore(
    new Map([
      ['memory/agents/core/daily/2026-04-10.md', '- TODO 完成温层摘要'],
      ['memory/agents/core/daily/2026-03-01.md', '- TODO 保留冷层索引'],
    ]),
  );

  const first = await syncAgentMemoryLifecycleFromStore({
    agentSlug: 'core',
    fileStore,
    now: '2026-04-20T12:00:00.000Z',
  });
  assert.deepEqual(first, {
    scannedCount: 2,
    warmUpdated: 1,
    coldUpdated: 1,
    skippedCount: 0,
    failures: [],
  });
  assert.deepEqual(fileStore.writes.sort(), [
    'memory/agents/core/daily/2026-03-01.cold.md',
    'memory/agents/core/daily/2026-04-10.warm.md',
  ]);

  fileStore.writes = [];
  const second = await syncAgentMemoryLifecycleFromStore({
    agentSlug: 'core',
    fileStore,
    now: '2026-04-20T12:00:00.000Z',
  });

  assert.deepEqual(second, {
    scannedCount: 2,
    warmUpdated: 0,
    coldUpdated: 0,
    skippedCount: 2,
    failures: [],
  });
  assert.deepEqual(fileStore.writes, []);
});

test('syncAgentMemoryLifecycleFromStore does not rewrite surrogates when only now changes', async () => {
  const fileStore = new InMemoryFileStore(
    new Map([['memory/agents/core/daily/2026-04-10.md', '- TODO 完成温层摘要']]),
  );

  const first = await syncAgentMemoryLifecycleFromStore({
    agentSlug: 'core',
    fileStore,
    now: '2026-04-20T12:00:00.000Z',
  });
  const firstWarm = await fileStore.readText('memory/agents/core/daily/2026-04-10.warm.md');

  fileStore.writes = [];
  const second = await syncAgentMemoryLifecycleFromStore({
    agentSlug: 'core',
    fileStore,
    now: '2026-04-21T12:00:00.000Z',
  });
  const secondWarm = await fileStore.readText('memory/agents/core/daily/2026-04-10.warm.md');

  assert.deepEqual(first, {
    scannedCount: 1,
    warmUpdated: 1,
    coldUpdated: 0,
    skippedCount: 0,
    failures: [],
  });
  assert.deepEqual(second, {
    scannedCount: 1,
    warmUpdated: 0,
    coldUpdated: 0,
    skippedCount: 1,
    failures: [],
  });
  assert.equal(secondWarm, firstWarm);
  assert.deepEqual(fileStore.writes, []);
});

test('syncAgentMemoryLifecycleFromStore removes stale surrogates when tier changes', async () => {
  const fileStore = new InMemoryFileStore(
    new Map([
      ['memory/agents/core/daily/2026-04-10.md', '- TODO 完成温层摘要'],
      ['memory/agents/core/daily/2026-03-01.md', '- TODO 保留冷层索引'],
      ['memory/agents/core/daily/2026-04-10.cold.md', 'stale cold surrogate'],
      ['memory/agents/core/daily/2026-03-01.warm.md', 'stale warm surrogate'],
      ['memory/agents/core/daily/2026-04-01.warm.md', 'stale warm surrogate'],
      ['memory/agents/core/daily/2026-04-01.cold.md', 'stale cold surrogate'],
    ]),
  );

  const warmColdResult = await syncAgentMemoryLifecycleFromStore({
    agentSlug: 'core',
    fileStore,
    now: '2026-04-20T12:00:00.000Z',
  });

  assert.equal(warmColdResult.warmUpdated, 1);
  assert.equal(warmColdResult.coldUpdated, 1);
  assert.ok(fileStore.deletes.includes('memory/agents/core/daily/2026-04-10.cold.md'));
  assert.ok(fileStore.deletes.includes('memory/agents/core/daily/2026-03-01.warm.md'));
  assert.equal(await fileStore.readText('memory/agents/core/daily/2026-04-10.cold.md'), null);
  assert.equal(await fileStore.readText('memory/agents/core/daily/2026-03-01.warm.md'), null);

  fileStore.deletes = [];
  const hotFileStore = new InMemoryFileStore(
    new Map([
      ['memory/agents/core/daily/2026-04-19.md', '- TODO 保持热层'],
      ['memory/agents/core/daily/2026-04-19.warm.md', 'stale warm surrogate'],
      ['memory/agents/core/daily/2026-04-19.cold.md', 'stale cold surrogate'],
    ]),
  );

  const hotResult = await syncAgentMemoryLifecycleFromStore({
    agentSlug: 'core',
    fileStore: hotFileStore,
    now: '2026-04-20T12:00:00.000Z',
  });

  assert.equal(hotResult.warmUpdated, 0);
  assert.equal(hotResult.coldUpdated, 0);
  assert.ok(hotFileStore.deletes.includes('memory/agents/core/daily/2026-04-19.warm.md'));
  assert.ok(hotFileStore.deletes.includes('memory/agents/core/daily/2026-04-19.cold.md'));
  assert.equal(await hotFileStore.readText('memory/agents/core/daily/2026-04-19.warm.md'), null);
  assert.equal(await hotFileStore.readText('memory/agents/core/daily/2026-04-19.cold.md'), null);
});

test('syncAgentMemoryLifecycleFromStore removes the old warm surrogate after a date enters cold tier', async () => {
  const fileStore = new InMemoryFileStore(
    new Map([
      ['memory/agents/core/daily/2026-03-01.md', '- [09:00] Legacy Topic · You: 旧项目背景。\n- [10:00] TODO 清理遗留状态。'],
      ['memory/agents/core/daily/2026-03-01.warm.md', 'stale warm surrogate'],
    ]),
  );

  const result = await syncAgentMemoryLifecycleFromStore({
    agentSlug: 'core',
    fileStore,
    now: '2026-04-20T12:00:00.000Z',
  });

  assert.deepEqual(result, {
    scannedCount: 1,
    warmUpdated: 0,
    coldUpdated: 1,
    skippedCount: 0,
    failures: [],
  });
  assert.equal(await fileStore.readText('memory/agents/core/daily/2026-03-01.warm.md'), null);
  assert.match((await fileStore.readText('memory/agents/core/daily/2026-03-01.cold.md')) ?? '', /tier: "cold"/);
});

test('syncAgentMemoryLifecycleFromStore removes orphaned surrogates when the source daily file is missing', async () => {
  const fileStore = new InMemoryFileStore(
    new Map([
      ['memory/agents/core/daily/2026-04-10.warm.md', 'orphan warm'],
      ['memory/agents/core/daily/2026-04-10.cold.md', 'orphan cold'],
    ]),
  );

  const result = await syncAgentMemoryLifecycleFromStore({
    agentSlug: 'core',
    fileStore,
    now: '2026-04-20T12:00:00.000Z',
  });

  assert.deepEqual(result, {
    scannedCount: 0,
    warmUpdated: 0,
    coldUpdated: 0,
    skippedCount: 0,
    failures: [],
  });
  assert.ok(fileStore.deletes.includes('memory/agents/core/daily/2026-04-10.warm.md'));
  assert.ok(fileStore.deletes.includes('memory/agents/core/daily/2026-04-10.cold.md'));
  assert.equal(await fileStore.readText('memory/agents/core/daily/2026-04-10.warm.md'), null);
  assert.equal(await fileStore.readText('memory/agents/core/daily/2026-04-10.cold.md'), null);
});

test('syncAgentMemoryLifecycleFromStore removes stale surrogates when the source daily file is empty', async () => {
  const fileStore = new InMemoryFileStore(
    new Map([
      ['memory/agents/core/daily/2026-04-10.md', '   \n'],
      ['memory/agents/core/daily/2026-04-10.warm.md', 'stale warm surrogate'],
      ['memory/agents/core/daily/2026-04-10.cold.md', 'stale cold surrogate'],
    ]),
  );

  const result = await syncAgentMemoryLifecycleFromStore({
    agentSlug: 'core',
    fileStore,
    now: '2026-04-20T12:00:00.000Z',
  });

  assert.deepEqual(result, {
    scannedCount: 1,
    warmUpdated: 0,
    coldUpdated: 0,
    skippedCount: 1,
    failures: [],
  });
  assert.ok(fileStore.deletes.includes('memory/agents/core/daily/2026-04-10.warm.md'));
  assert.ok(fileStore.deletes.includes('memory/agents/core/daily/2026-04-10.cold.md'));
  assert.equal(await fileStore.readText('memory/agents/core/daily/2026-04-10.warm.md'), null);
  assert.equal(await fileStore.readText('memory/agents/core/daily/2026-04-10.cold.md'), null);
});

test('syncAgentMemoryLifecycleFromStore records delete failures and continues', async () => {
  const fileStore = new DeleteFailingFileStore(
    new Map([
      ['memory/agents/core/daily/2026-04-10.md', '- TODO 完成温层摘要'],
      ['memory/agents/core/daily/2026-04-10.cold.md', 'stale cold surrogate'],
      ['memory/agents/core/daily/2026-04-11.warm.md', 'orphan warm surrogate'],
    ]),
    new Set([
      'memory/agents/core/daily/2026-04-10.cold.md',
      'memory/agents/core/daily/2026-04-11.warm.md',
    ]),
  );

  const result = await syncAgentMemoryLifecycleFromStore({
    agentSlug: 'core',
    fileStore,
    now: '2026-04-20T12:00:00.000Z',
  });

  assert.deepEqual(result, {
    scannedCount: 1,
    warmUpdated: 1,
    coldUpdated: 0,
    skippedCount: 0,
    failures: [
      {
        path: 'memory/agents/core/daily/2026-04-10.cold.md',
        message: 'Cannot delete memory/agents/core/daily/2026-04-10.cold.md',
      },
      {
        path: 'memory/agents/core/daily/2026-04-11.warm.md',
        message: 'Cannot delete memory/agents/core/daily/2026-04-11.warm.md',
      },
    ],
  });
  assert.match((await fileStore.readText('memory/agents/core/daily/2026-04-10.warm.md')) ?? '', /tier: "warm"/);
  assert.equal(await fileStore.readText('memory/agents/core/daily/2026-04-10.cold.md'), 'stale cold surrogate');
  assert.equal(await fileStore.readText('memory/agents/core/daily/2026-04-11.warm.md'), 'orphan warm surrogate');
});

test('syncAgentMemoryLifecycleFromStore reports missing delete support when stale surrogates exist', async () => {
  const fileStore = new ReadOnlyLifecycleFileStore(
    new Map([
      ['memory/agents/core/daily/2026-04-10.md', '- TODO 完成温层摘要'],
      ['memory/agents/core/daily/2026-04-10.cold.md', 'stale cold surrogate'],
    ]),
  );

  const result = await syncAgentMemoryLifecycleFromStore({
    agentSlug: 'core',
    fileStore,
    now: '2026-04-20T12:00:00.000Z',
  });

  assert.deepEqual(result, {
    scannedCount: 1,
    warmUpdated: 1,
    coldUpdated: 0,
    skippedCount: 0,
    failures: [
      {
        path: 'memory/agents/core/daily/2026-04-10.cold.md',
        message: 'The active memory file store cannot delete memory/agents/core/daily/2026-04-10.cold.md.',
      },
    ],
  });
});

test('listAgentMemoryFiles exposes warm and cold surrogate entries distinctly', async () => {
  const rootDir = await createTempRoot();
  const server = await startServer(rootDir);
  const settings = {
    enabled: true,
    baseUrl: server.baseUrl,
    authToken: '',
  };

  try {
    await writeAgentMemoryFile('memory/agents/core/daily/2026-04-10.md', '- source', settings);
    await writeAgentMemoryFile('memory/agents/core/daily/2026-04-10.warm.md', '- warm', settings);
    await writeAgentMemoryFile('memory/agents/core/daily/2026-04-10.cold.md', '- cold', settings);

    const entries = await listAgentMemoryFiles('core', settings);
    const dailyKinds = entries.filter((entry) => entry.path.includes('/daily/')).map((entry) => entry.kind);

    assert.deepEqual(dailyKinds.sort(), ['daily_cold', 'daily_source', 'daily_warm']);
    assert.deepEqual(
      entries
        .filter((entry) => entry.path.includes('/daily/'))
        .map((entry) => entry.label)
        .sort(),
      ['2026-04-10.cold.md', '2026-04-10.md', '2026-04-10.warm.md'],
    );
  } finally {
    await server.close();
  }
});

test('API server startup catch-up generates warm and cold surrogate files before the server is used', async () => {
  const rootDir = await createTempRoot();
  await mkdir(path.join(rootDir, '.flowagent'), { recursive: true });
  await mkdir(path.join(rootDir, 'memory/agents/core/daily'), { recursive: true });
  await writeFile(
    path.join(rootDir, 'memory/agents/core/daily/2026-04-10.md'),
    '- TODO warm summary from startup catch-up.',
    'utf8',
  );
  await writeFile(
    path.join(rootDir, 'memory/agents/core/daily/2026-03-01.md'),
    '- TODO cold summary from startup catch-up.',
    'utf8',
  );
  await writeFile(
    path.join(rootDir, '.flowagent/nightly-memory-archive-settings.json'),
    JSON.stringify({ enabled: true, time: '03:00' }, null, 2),
    'utf8',
  );
  await writeFile(
    path.join(rootDir, '.flowagent/nightly-memory-archive-state.json'),
    JSON.stringify(
      {
        lastSuccessfulRunAt: '2026-04-19T01:00:00.000Z',
        lastSuccessfulRunDate: '2026-04-19',
        lastAttemptedRunAt: '2026-04-19T01:00:00.000Z',
        lastRunSummary: null,
      },
      null,
      2,
    ),
    'utf8',
  );

  const server = await startServer(rootDir);
  try {
    const warm = await readFile(path.join(rootDir, 'memory/agents/core/daily/2026-04-10.warm.md'), 'utf8');
    const cold = await readFile(path.join(rootDir, 'memory/agents/core/daily/2026-03-01.cold.md'), 'utf8');

    assert.match(warm, /tier: "warm"/);
    assert.match(cold, /tier: "cold"/);
  } finally {
    await server.close();
  }
});
