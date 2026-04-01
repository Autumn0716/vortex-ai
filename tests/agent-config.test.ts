import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDocumentProcessingSettings } from '../src/lib/agent/config';

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
