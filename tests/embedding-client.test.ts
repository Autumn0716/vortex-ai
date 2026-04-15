import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildEmbeddingEndpoint,
  buildEmbeddingContentHash,
  createEmbeddings,
  type EmbeddingProviderConfig,
} from '../src/lib/embedding-client';

const TEST_CONFIG: EmbeddingProviderConfig = {
  apiKey: 'test-key',
  model: 'text-embedding-test',
  baseUrl: 'https://example.test/v1',
  dimensions: 3,
};

test('buildEmbeddingEndpoint appends /embeddings without duplicating trailing slashes', () => {
  assert.equal(buildEmbeddingEndpoint('https://example.test/v1'), 'https://example.test/v1/embeddings');
  assert.equal(buildEmbeddingEndpoint('https://example.test/v1/'), 'https://example.test/v1/embeddings');
});

test('createEmbeddings surfaces transport failures with a stable prefix', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error('connect ECONNREFUSED');
  }) as typeof fetch;

  try {
    await assert.rejects(
      createEmbeddings('hello', TEST_CONFIG),
      /Embedding request failed: connect ECONNREFUSED/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('createEmbeddings surfaces remote API error payloads', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    ({
      ok: false,
      status: 401,
      async json() {
        return {
          error: {
            message: 'invalid embedding key',
          },
        };
      },
    }) as Response) as typeof fetch;

  try {
    await assert.rejects(createEmbeddings('hello', TEST_CONFIG), /invalid embedding key/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('buildEmbeddingContentHash normalizes casing and whitespace', () => {
  assert.equal(buildEmbeddingContentHash('Alpha   Beta'), buildEmbeddingContentHash(' alpha beta '));
});
