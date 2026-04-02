import test from 'node:test';
import assert from 'node:assert/strict';
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
    enableWebExtractor: true,
    enableCodeInterpreter: true,
    enableMcp: true,
  });

  assert.deepEqual(tools[0], { type: 'web_search' });
  assert.deepEqual(tools[1], { type: 'web_extractor' });
  assert.deepEqual(tools[2], { type: 'code_interpreter' });
  assert.equal(tools[3]?.type, 'mcp');
  assert.equal((tools[3] as Record<string, unknown>).server_protocol, 'sse');
});
