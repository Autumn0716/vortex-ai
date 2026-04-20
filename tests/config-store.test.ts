import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { getConfigFilePath, readProjectConfig, writeProjectConfig } from '../server/config-store';
import { formatErrorDetails } from '../src/lib/error-details';
import { type AgentConfig, normalizeAgentConfig } from '../src/lib/agent/config';

const tempRoots: string[] = [];

test.after(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
});

async function createTempRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'vortex-config-store-'));
  tempRoots.push(root);
  return root;
}

test('readProjectConfig creates config.json from defaults when missing', async () => {
  const rootDir = await createTempRoot();

  const config = await readProjectConfig(rootDir);

  assert.equal(getConfigFilePath(rootDir), path.join(rootDir, 'config.json'));
  assert.equal(config.activeProviderId, 'openai');
  assert.equal(config.apiServer.baseUrl, 'http://127.0.0.1:3850');
  assert.equal(config.memory.includeRecentMemorySnapshot, true);

  const written = JSON.parse(await readFile(path.join(rootDir, 'config.json'), 'utf8'));
  assert.equal(written.apiServer.baseUrl, 'http://127.0.0.1:3850');
});

test('writeProjectConfig persists normalized config to config.json', async () => {
  const rootDir = await createTempRoot();

  const saved = await writeProjectConfig(rootDir, {
    activeProviderId: 'openai',
    activeModel: 'gpt-4o',
    apiServer: { enabled: true, baseUrl: 'http://127.0.0.1:3850' },
    memory: { includeRecentMemorySnapshot: false },
  } as Partial<AgentConfig>);

  const expected = normalizeAgentConfig({
    activeProviderId: 'openai',
    activeModel: 'gpt-4o',
    apiServer: { enabled: true, baseUrl: 'http://127.0.0.1:3850' },
    memory: { includeRecentMemorySnapshot: false },
  } as Partial<AgentConfig>);

  assert.deepEqual(saved, expected);

  const written = JSON.parse(await readFile(path.join(rootDir, 'config.json'), 'utf8'));
  assert.deepEqual(written, expected);
});

test('readProjectConfig wraps malformed config.json with file context', async () => {
  const rootDir = await createTempRoot();
  const configPath = path.join(rootDir, 'config.json');

  await import('node:fs/promises').then(({ writeFile }) => writeFile(configPath, '{bad json', 'utf8'));

  await assert.rejects(async () => readProjectConfig(rootDir), (error: unknown) => {
    const details = formatErrorDetails(error);
    assert.match(details, /Failed to read project config at/);
    assert.match(details, /config\.json/);
    assert.match(details, /Unexpected token|Expected property name|JSON/i);
    return true;
  });
});
