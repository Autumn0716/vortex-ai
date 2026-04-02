import test from 'node:test';
import assert from 'node:assert/strict';
import {
  type AgentConfig,
  loadConfigWithMigration,
  normalizeAgentConfig,
  resolveDocumentProcessingSettings,
} from '../src/lib/agent/config';

test('resolveDocumentProcessingSettings falls back to embedding environment defaults', () => {
  const settings = resolveDocumentProcessingSettings(
    {
      enableVectorSearch: true,
      embeddingApiKey: '',
      embeddingModel: '',
      embeddingBaseUrl: '',
      embeddingDimensions: 0,
    },
    {
      apiKey: 'env-key',
      model: 'env-model',
      baseUrl: 'https://env.example.com/v1',
      dimensions: 768,
    },
  );

  assert.equal(settings.embeddingApiKey, 'env-key');
  assert.equal(settings.embeddingModel, 'env-model');
  assert.equal(settings.embeddingBaseUrl, 'https://env.example.com/v1');
  assert.equal(settings.embeddingDimensions, 768);
});

test('resolveDocumentProcessingSettings prefers explicit saved values over env defaults', () => {
  const settings = resolveDocumentProcessingSettings(
    {
      embeddingApiKey: 'saved-key',
      embeddingModel: 'saved-model',
      embeddingBaseUrl: 'https://saved.example.com/v1',
      embeddingDimensions: 1024,
    },
    {
      apiKey: 'env-key',
      model: 'env-model',
      baseUrl: 'https://env.example.com/v1',
      dimensions: 768,
    },
  );

  assert.equal(settings.embeddingApiKey, 'saved-key');
  assert.equal(settings.embeddingModel, 'saved-model');
  assert.equal(settings.embeddingBaseUrl, 'https://saved.example.com/v1');
  assert.equal(settings.embeddingDimensions, 1024);
});

test('normalizeAgentConfig preserves the recent memory snapshot toggle', () => {
  const config = normalizeAgentConfig({
    memory: {
      includeRecentMemorySnapshot: false,
    },
  } as Partial<AgentConfig>);

  assert.equal(config.memory.includeRecentMemorySnapshot, false);
});

test('normalizeAgentConfig keeps the local api server defaults for file-backed memory', () => {
  const config = normalizeAgentConfig({
    apiServer: {
      enabled: true,
    },
  } as Partial<AgentConfig>);

  assert.equal(config.apiServer.enabled, true);
  assert.equal(config.apiServer.baseUrl, 'http://127.0.0.1:3850');
});

test('loadConfigWithMigration migrates legacy browser config when host config is still default', async () => {
  const legacy = normalizeAgentConfig({
    activeProviderId: 'openai',
    activeModel: 'gpt-4o',
    memory: {
      includeRecentMemorySnapshot: false,
    },
  } as Partial<AgentConfig>);
  const writes: AgentConfig[] = [];
  let cleared = 0;

  const loaded = await loadConfigWithMigration({
    readLegacyConfig: async () => legacy,
    clearLegacyConfig: async () => {
      cleared += 1;
    },
    readHostConfig: async () => normalizeAgentConfig(),
    writeHostConfig: async (_settings, value) => {
      writes.push(value);
      return value;
    },
  });

  assert.equal(loaded.memory.includeRecentMemorySnapshot, false);
  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.memory.includeRecentMemorySnapshot, false);
  assert.equal(cleared, 1);
});

test('loadConfigWithMigration falls back to defaults when host is unavailable and no legacy config exists', async () => {
  const loaded = await loadConfigWithMigration({
    readLegacyConfig: async () => null,
    readHostConfig: async () => {
      throw new Error('connect ECONNREFUSED');
    },
  });

  assert.equal(loaded.activeProviderId, 'openai');
  assert.equal(loaded.apiServer.baseUrl, 'http://127.0.0.1:3850');
});
