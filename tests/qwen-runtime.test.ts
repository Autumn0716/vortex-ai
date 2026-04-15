import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { normalizeAgentConfig } from '../src/lib/agent/config';
import { buildChatModelKwargs, buildResponseTools } from '../src/lib/agent/runtime';

test('buildChatModelKwargs adds thinking extra_body for chat-compatible qwen calls', () => {
  const kwargs = buildChatModelKwargs({
    enableThinking: true,
    structuredOutput: { mode: 'text' },
  });

  assert.deepEqual(kwargs.extra_body, { enable_thinking: true });
  assert.deepEqual(kwargs.stream_options, { include_usage: true });
});

test('buildChatModelKwargs emits response_format for json_object and disables thinking outside caller logic', () => {
  const kwargs = buildChatModelKwargs({
    enableThinking: false,
    structuredOutput: { mode: 'json_object' },
  });

  assert.deepEqual(kwargs.response_format, { type: 'json_object' });
});

test('buildChatModelKwargs surfaces contextual errors for malformed json_schema payloads', () => {
  assert.throws(
    () =>
      buildChatModelKwargs({
        enableThinking: false,
        structuredOutput: { mode: 'json_schema', schema: '{"type":"object"' },
      }),
    /Structured output schema is not valid JSON: \{"type":"object"/,
  );
});

test('buildResponseTools includes official qwen responses tools and enabled SSE MCP servers only', () => {
  const config = normalizeAgentConfig({
    mcpServers: [
      {
        id: 'mcp_sse',
        name: 'Search MCP',
        url: 'https://example.com/sse',
        description: 'SSE MCP',
        enabled: true,
        transport: 'sse',
        command: '',
        args: '',
        headers: '{"Authorization":"Bearer token"}',
        source: 'custom',
        provider: 'Custom',
      },
      {
        id: 'mcp_stdio',
        name: 'Stdio MCP',
        url: '',
        description: 'stdio',
        enabled: true,
        transport: 'stdio',
        command: 'node',
        args: 'server.js',
        headers: '',
        source: 'custom',
        provider: 'Custom',
      },
    ],
  });

  const tools = buildResponseTools(config, {
    enableTools: true,
    enableWebSearch: true,
    enableWebSearchImage: true,
    enableWebExtractor: true,
    enableCodeInterpreter: true,
    enableImageSearch: true,
    enableMcp: true,
  });

  assert.deepEqual(tools[0], { type: 'web_search' });
  assert.deepEqual(tools[1], { type: 'web_search_image' });
  assert.deepEqual(tools[2], { type: 'web_extractor' });
  assert.deepEqual(tools[3], { type: 'code_interpreter' });
  assert.deepEqual(tools[4], { type: 'image_search' });
  assert.equal(tools[5]?.type, 'mcp');
  assert.equal((tools[5] as Record<string, unknown>).server_protocol, 'sse');
});

test('buildResponseTools appends custom function tools using official responses schema', () => {
  const config = normalizeAgentConfig();
  const tools = buildResponseTools(config, {
    enableTools: true,
    enableWebSearch: false,
    customTools: [
      {
        name: 'search_knowledge_base',
        description: 'Search local docs',
        schema: z.object({
          query: z.string(),
        }),
      },
    ],
  });

  const functionTool = tools.find((entry) => (entry as Record<string, unknown>).type === 'function') as
    | Record<string, unknown>
    | undefined;
  assert.ok(functionTool);
  assert.equal(functionTool?.name, 'search_knowledge_base');
  assert.equal(functionTool?.description, 'Search local docs');
  assert.equal((functionTool?.parameters as Record<string, unknown>).type, 'object');
});
