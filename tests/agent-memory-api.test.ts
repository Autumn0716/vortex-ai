import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import { createFlowAgentApiServer, resolveAllowedPath } from '../server/api-server';
import {
  getApiServerHealth,
  getNightlyArchiveStatus,
  listAgentMemoryFiles,
  readAgentMemoryFile,
  registerConfiguredAgentMemoryFileStore,
  saveNightlyArchiveSettings,
  writeAgentMemoryFile,
} from '../src/lib/agent-memory-api';
import { getAgentMemoryFileStore, setAgentMemoryFileStore } from '../src/lib/agent-memory-sync';

const tempRoots: string[] = [];

after(async () => {
  setAgentMemoryFileStore(null);
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
});

async function createTempRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'flowagent-api-'));
  tempRoots.push(root);
  return root;
}

async function startServer(rootDir: string, authToken = '', nightlyArchiveNow?: () => string | Date) {
  const { app, nightlyArchiveReady, nightlyArchiveScheduler } = createFlowAgentApiServer({
    rootDir,
    authToken,
    nightlyArchiveNow,
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

test('resolveAllowedPath only permits memory files under memory/agents', () => {
  const allowed = resolveAllowedPath('/tmp/project', 'memory/agents/flowagent-core/MEMORY.md');
  assert.match(allowed.absolutePath, /memory\/agents\/flowagent-core\/MEMORY\.md$/);

  assert.throws(() => resolveAllowedPath('/tmp/project', '../secrets.txt'), /Only memory\/agents paths are allowed|Invalid path/);
  assert.throws(
    () => resolveAllowedPath('/tmp/project', 'memory/agents/flowagent-core/notes.txt', { allowDirectory: false }),
    /Only Markdown memory files are allowed/,
  );
});

test('API server health and file operations work through the registered memory file store', async () => {
  const rootDir = await createTempRoot();
  const server = await startServer(rootDir);
  const settings = {
    enabled: true,
    baseUrl: server.baseUrl,
    authToken: '',
  };

  try {
    const health = await getApiServerHealth(settings);
    assert.equal(health?.ok, true);
    assert.equal(health?.rootDir, rootDir);
    assert.equal(health?.nightlyArchive?.enabled, false);
    assert.equal(health?.nightlyArchive?.time, '03:00');

    registerConfiguredAgentMemoryFileStore(settings);
    const fileStore = getAgentMemoryFileStore();
    assert.ok(fileStore);

    await fileStore!.writeText('memory/agents/flowagent-core/MEMORY.md', '# Memory\n\n默认使用中文输出。');
    await fileStore!.writeText(
      'memory/agents/flowagent-core/daily/2026-04-01.md',
      '# 2026-04-01\n\n- TODO: verify file-backed runtime.',
    );

    assert.equal(
      await fileStore!.readText('memory/agents/flowagent-core/MEMORY.md'),
      '# Memory\n\n默认使用中文输出。',
    );
    assert.deepEqual(await fileStore!.listPaths('memory/agents/flowagent-core'), [
      'memory/agents/flowagent-core/MEMORY.md',
      'memory/agents/flowagent-core/daily/2026-04-01.md',
    ]);

    const diskContent = await readFile(path.join(rootDir, 'memory/agents/flowagent-core/MEMORY.md'), 'utf8');
    assert.equal(diskContent, '# Memory\n\n默认使用中文输出。');
  } finally {
    await server.close();
  }
});

test('API server exposes readable and writable nightly archive settings', async () => {
  const rootDir = await createTempRoot();
  const server = await startServer(rootDir);
  const settings = {
    enabled: true,
    baseUrl: server.baseUrl,
    authToken: '',
  };

  try {
    const initialStatus = await getNightlyArchiveStatus(settings);
    assert.equal(initialStatus?.settings.enabled, false);
    assert.equal(initialStatus?.settings.time, '03:00');

    const nextStatus = await saveNightlyArchiveSettings(settings, {
      enabled: true,
      time: '04:30',
    });
    assert.equal(nextStatus?.settings.enabled, true);
    assert.equal(nextStatus?.settings.time, '04:30');

    const settingsFile = await readFile(path.join(rootDir, '.flowagent/nightly-memory-archive-settings.json'), 'utf8');
    assert.match(settingsFile, /"time": "04:30"/);

    const health = await getApiServerHealth(settings);
    assert.equal(health?.nightlyArchive?.enabled, true);
    assert.equal(health?.nightlyArchive?.time, '04:30');
  } finally {
    await server.close();
  }
});

test('API file helpers respect auth token protection', async () => {
  const rootDir = await createTempRoot();
  const server = await startServer(rootDir, 'secret-token');
  const authorized = {
    enabled: true,
    baseUrl: server.baseUrl,
    authToken: 'secret-token',
  };
  const unauthorized = {
    enabled: true,
    baseUrl: server.baseUrl,
    authToken: '',
  };

  try {
    await writeAgentMemoryFile('memory/agents/flowagent-core/MEMORY.md', 'Authenticated write.', authorized);
    assert.equal(
      await readAgentMemoryFile('memory/agents/flowagent-core/MEMORY.md', authorized),
      'Authenticated write.',
    );

    await assert.rejects(
      () => readAgentMemoryFile('memory/agents/flowagent-core/MEMORY.md', unauthorized),
      /Unauthorized/,
    );
  } finally {
    await server.close();
  }
});

test('API memory file listing includes warm and cold surrogate markdown files', async () => {
  const rootDir = await createTempRoot();
  const server = await startServer(rootDir);
  const settings = {
    enabled: true,
    baseUrl: server.baseUrl,
    authToken: '',
  };

  try {
    await writeAgentMemoryFile('memory/agents/flowagent-core/MEMORY.md', '# Memory', settings);
    await writeAgentMemoryFile('memory/agents/flowagent-core/daily/2026-04-01.md', '# Source', settings);
    await writeAgentMemoryFile('memory/agents/flowagent-core/daily/2026-04-01.warm.md', '# Warm', settings);
    await writeAgentMemoryFile('memory/agents/flowagent-core/daily/2026-04-01.cold.md', '# Cold', settings);

    const files = await listAgentMemoryFiles('flowagent-core', settings);
    assert.deepEqual(
      files.filter((file) => file.path.includes('/daily/')).map((file) => [file.path, file.kind, file.label]),
      [
        ['memory/agents/flowagent-core/daily/2026-04-01.warm.md', 'daily_warm', '2026-04-01.warm.md'],
        ['memory/agents/flowagent-core/daily/2026-04-01.md', 'daily_source', '2026-04-01.md'],
        ['memory/agents/flowagent-core/daily/2026-04-01.cold.md', 'daily_cold', '2026-04-01.cold.md'],
      ],
    );
  } finally {
    await server.close();
  }
});
