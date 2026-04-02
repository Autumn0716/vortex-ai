import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProviderModelListCandidates,
  getDefaultProviderProtocol,
  getProviderRequestMode,
  getProviderRequestPreview,
} from '../src/lib/provider-compatibility';

test('responses-compatible providers fall back to the chat-compatible model list endpoint', () => {
  const candidates = buildProviderModelListCandidates({
    baseUrl: 'https://dashscope.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1',
    protocol: 'openai_responses_compatible',
  });

  assert.deepEqual(candidates, [
    'https://dashscope.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1/models',
    'https://dashscope.aliyuncs.com/compatible-mode/v1/models',
  ]);
});

test('provider protocol defaults stay aligned with provider types', () => {
  assert.equal(getDefaultProviderProtocol('openai'), 'openai_chat_compatible');
  assert.equal(getDefaultProviderProtocol('custom_openai'), 'openai_chat_compatible');
  assert.equal(getDefaultProviderProtocol('anthropic'), 'anthropic_native');
});

test('provider request mode and preview reflect protocol choice', () => {
  assert.equal(getProviderRequestMode('openai_chat_compatible'), 'chat_completions');
  assert.equal(getProviderRequestMode('openai_responses_compatible'), 'responses');
  assert.equal(
    getProviderRequestPreview(
      'https://dashscope.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1',
      'openai_responses_compatible',
    ),
    'https://dashscope.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1/responses',
  );
});
