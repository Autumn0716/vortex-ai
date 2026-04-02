import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import { createFlowAgentApiServer } from '../server/api-server';
import { getProjectKnowledgeSnapshot, getProjectKnowledgeStatus } from '../src/lib/project-knowledge-api';

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
  await writeFile(path.join(rootDir, 'README.md'), '# FlowAgent\n\nworkspace guidance', 'utf8');
  await writeFile(path.join(rootDir, 'docs/guide.md'), '# Guide\n\nuse docs', 'utf8');
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
    assert.equal(statusBefore?.documentCount, 3);
    assert.ok(statusBefore?.paths.includes('skills/systematic-debugging/SKILL.md'));

    const snapshot = await getProjectKnowledgeSnapshot(settings);
    assert.equal(snapshot?.documents.length, 3);
    assert.equal(
      snapshot?.documents.find((document) => document.sourceUri === 'skills/systematic-debugging/SKILL.md')?.sourceType,
      'skill_doc',
    );
    assert.equal(
      snapshot?.documents.find((document) => document.sourceUri === 'README.md')?.sourceType,
      'workspace_doc',
    );

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
