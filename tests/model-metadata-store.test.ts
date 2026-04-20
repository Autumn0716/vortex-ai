import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createModelMetadataStoreKey,
  getModelMetadataStorePath,
  listStoredModelMetadata,
  patchStoredModelMetadata,
} from '../server/model-metadata-store';
import { formatErrorDetails } from '../src/lib/error-details';

const tempRoots: string[] = [];

test.after(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
});

async function createTempRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'vortex-model-metadata-store-'));
  tempRoots.push(root);
  return root;
}

test('patchStoredModelMetadata writes entries keyed by provider and model', async () => {
  const rootDir = await createTempRoot();

  const entry = await patchStoredModelMetadata(rootDir, 'aliyun', 'Aliyun', 'qwen3.5-plus', {
    contextWindow: 983_616,
    maxOutputTokens: 65_536,
  });

  assert.equal(entry.providerId, 'aliyun');
  assert.equal(entry.model, 'qwen3.5-plus');

  const stored = await listStoredModelMetadata(rootDir, 'aliyun');
  assert.ok(stored['qwen3.5-plus']);

  const disk = JSON.parse(await readFile(getModelMetadataStorePath(rootDir), 'utf8')) as {
    entries: Record<string, { providerId: string; model: string }>;
  };
  assert.deepEqual(disk.entries[createModelMetadataStoreKey('aliyun', 'qwen3.5-plus')], {
    ...disk.entries[createModelMetadataStoreKey('aliyun', 'qwen3.5-plus')],
    providerId: 'aliyun',
    model: 'qwen3.5-plus',
  });
});

test('listStoredModelMetadata wraps malformed store files with file context', async () => {
  const rootDir = await createTempRoot();
  const storePath = getModelMetadataStorePath(rootDir);
  await writeFile(storePath, '{bad json', 'utf8');

  await assert.rejects(async () => listStoredModelMetadata(rootDir, 'aliyun'), (error: unknown) => {
    const details = formatErrorDetails(error);
    assert.match(details, /Failed to read model metadata store at/);
    assert.match(details, /model-metadata\.json/);
    assert.match(details, /Unexpected token|Expected property name|JSON/i);
    return true;
  });
});
