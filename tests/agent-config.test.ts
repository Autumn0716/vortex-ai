import test from 'node:test';
import assert from 'node:assert/strict';
import { type AgentConfig, normalizeAgentConfig, resolveDocumentProcessingSettings } from '../src/lib/agent/config';

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
