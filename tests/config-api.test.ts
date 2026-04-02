import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import { createFlowAgentApiServer } from '../server/api-server';
import { getProjectConfig, saveProjectConfig } from '../src/lib/agent-memory-api';

const tempRoots: string[] = [];

after(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
});

async function createTempRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'flowagent-config-api-'));
  tempRoots.push(root);
  return root;
}

async function startServer(rootDir: string) {
  const { app, nightlyArchiveReady, nightlyArchiveScheduler } = createFlowAgentApiServer({
    rootDir,
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

test('project config is readable and writable through the local API helpers', async () => {
  const rootDir = await createTempRoot();
  const server = await startServer(rootDir);
  const settings = {
    enabled: true,
    baseUrl: server.baseUrl,
    authToken: '',
  };

  try {
    const initial = await getProjectConfig(settings);
    assert.equal(initial?.apiServer.baseUrl, 'http://127.0.0.1:3850');

    const initialDisk = JSON.parse(await readFile(path.join(rootDir, 'config.json'), 'utf8')) as {
      apiServer: { baseUrl: string };
    };
    assert.equal(initialDisk.apiServer.baseUrl, 'http://127.0.0.1:3850');

    const updated = await saveProjectConfig(settings, {
      activeProviderId: 'openai',
      apiServer: {
        enabled: true,
        baseUrl: 'http://127.0.0.1:3999',
        authToken: 'token',
      },
    });

    assert.equal(updated?.apiServer.baseUrl, 'http://127.0.0.1:3999');
    assert.equal(updated?.apiServer.authToken, 'token');

    const updatedDisk = JSON.parse(await readFile(path.join(rootDir, 'config.json'), 'utf8')) as {
      activeProviderId: string;
      apiServer: { baseUrl: string; authToken: string };
    };
    assert.equal(updatedDisk.activeProviderId, 'openai');
    assert.equal(updatedDisk.apiServer.baseUrl, 'http://127.0.0.1:3999');
    assert.equal(updatedDisk.apiServer.authToken, 'token');

    const reread = await getProjectConfig(settings);
    assert.equal(reread?.apiServer.baseUrl, 'http://127.0.0.1:3999');
  } finally {
    await server.close();
  }
});
