import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import { createFlowAgentApiServer } from '../server/api-server';
import {
  getProjectKnowledgeSnapshot,
  getProjectKnowledgeStatus,
  subscribeProjectKnowledgeEvents,
} from '../src/lib/project-knowledge-api';

const tempRoots: string[] = [];

after(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
});

async function createTempRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'flowagent-project-knowledge-'));
  tempRoots.push(root);
  return root;
}

async function startServer(rootDir: string) {
  const { app, nightlyArchiveReady, nightlyArchiveScheduler, projectKnowledgeWatcher, projectKnowledgeReady } =
    createFlowAgentApiServer({ rootDir });
  await Promise.all([nightlyArchiveReady, projectKnowledgeReady]);
  const server = await new Promise<Server>((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    instance.on('error', reject);
  });
  const address = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      nightlyArchiveScheduler.stop();
      projectKnowledgeWatcher.stop();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

async function waitFor(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

test('project knowledge API exposes shared docs and SKILL.md snapshots with change versions', async () => {
  const rootDir = await createTempRoot();
  await mkdir(path.join(rootDir, 'docs'), { recursive: true });
  await mkdir(path.join(rootDir, 'skills/systematic-debugging'), { recursive: true });
  await mkdir(path.join(rootDir, 'src/lib'), { recursive: true });
  await writeFile(path.join(rootDir, 'README.md'), '# FlowAgent\n\nworkspace guidance', 'utf8');
  await writeFile(path.join(rootDir, 'docs/guide.md'), '# Guide\n\nuse docs', 'utf8');
  await writeFile(
    path.join(rootDir, 'src/lib/runtime.ts'),
    "import { ok } from './result';\nexport function runRuntime() { return ok(true); }\n",
    'utf8',
  );
  await writeFile(
    path.join(rootDir, 'skills/systematic-debugging/SKILL.md'),
    '# Systematic Debugging\n\nUse reproduction first.',
    'utf8',
  );

  const server = await startServer(rootDir);
  const settings = {
    enabled: true,
    baseUrl: server.baseUrl,
    authToken: '',
  };

  try {
    const statusBefore = await getProjectKnowledgeStatus(settings);
    assert.equal(statusBefore?.documentCount, 4);
    assert.ok(statusBefore?.paths.includes('skills/systematic-debugging/SKILL.md'));
    assert.ok(statusBefore?.paths.includes('src/lib/runtime.ts'));

    const snapshot = await getProjectKnowledgeSnapshot(settings);
    assert.equal(snapshot?.documents.length, 4);
    assert.equal(
      snapshot?.documents.find((document) => document.sourceUri === 'skills/systematic-debugging/SKILL.md')?.sourceType,
      'skill_doc',
    );
    assert.equal(
      snapshot?.documents.find((document) => document.sourceUri === 'README.md')?.sourceType,
      'workspace_doc',
    );
    const codeDocument = snapshot?.documents.find((document) => document.sourceUri === 'src/lib/runtime.ts');
    assert.equal(codeDocument?.sourceType, 'code_doc');
    assert.match(codeDocument?.content ?? '', /export function runRuntime/);

    await writeFile(
      path.join(rootDir, 'skills/systematic-debugging/SKILL.md'),
      '# Systematic Debugging\n\nUse reproduction first and capture logs.',
      'utf8',
    );
    await waitFor(250);
    const statusAfter = await getProjectKnowledgeStatus(settings);
    assert.notEqual(statusAfter?.version, statusBefore?.version);
  } finally {
    await server.close();
  }
});

test('project knowledge API reports the local API url when the server is unreachable', async () => {
  await assert.rejects(
    () =>
      getProjectKnowledgeStatus({
        enabled: true,
        baseUrl: 'http://127.0.0.1:1',
        authToken: '',
      }),
    /Failed to reach local API server at http:\/\/127\.0\.0\.1:1\/api\/project-knowledge\/status/,
  );
});

test('project knowledge event subscription reports contextual parse failures for malformed SSE payloads', async () => {
  const events = new Map<string, (event: { data?: string }) => void>();
  const originalEventSource = globalThis.EventSource;

  class MockEventSource {
    url: string;

    onerror: (() => void) | null = null;

    constructor(url: string) {
      this.url = url;
    }

    addEventListener(type: string, listener: (event: { data?: string }) => void) {
      events.set(type, listener);
    }

    close() {}
  }

  globalThis.EventSource = MockEventSource as unknown as typeof EventSource;

  try {
    const receivedStatuses: unknown[] = [];
    const receivedErrors: string[] = [];
    const unsubscribe = subscribeProjectKnowledgeEvents(
      {
        enabled: true,
        baseUrl: 'http://127.0.0.1:3850',
        authToken: '',
      },
      {
        onStatus(status) {
          receivedStatuses.push(status);
        },
        onError(error) {
          receivedErrors.push(error.message);
        },
      },
    );

    events.get('project-knowledge')?.({ data: '{"version":' });

    assert.deepEqual(receivedStatuses, []);
    assert.equal(receivedErrors.length, 1);
    assert.match(receivedErrors[0] ?? '', /Failed to parse project knowledge event:/);
    assert.match(receivedErrors[0] ?? '', /\{"version":/);
    unsubscribe();
  } finally {
    globalThis.EventSource = originalEventSource;
  }
});
