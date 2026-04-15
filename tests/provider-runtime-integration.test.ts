import assert from 'node:assert/strict';
import test from 'node:test';

import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import type { AgentConfig, ModelProvider } from '../src/lib/agent/config';
import { normalizeAgentConfig } from '../src/lib/agent/config';
import { buildGroundedSystemPrompt, createAgentRuntime } from '../src/lib/agent/runtime';
import { compileTaskGraphFromGoal } from '../src/lib/task-graph-compiler';

function buildConfig(provider: Partial<ModelProvider> & Pick<ModelProvider, 'id' | 'name' | 'models'>) {
  return normalizeAgentConfig({
    activeProviderId: provider.id,
    activeModel: provider.models[0] || 'test-model',
    systemPrompt: 'Base system prompt.',
    providers: [
      {
        id: provider.id,
        name: provider.name,
        enabled: true,
        apiKey: 'test-key',
        baseUrl: 'https://example.com/v1',
        models: provider.models,
        type: 'custom_openai',
        protocol: 'openai_chat_compatible',
        ...provider,
      },
    ],
  } as Partial<AgentConfig>);
}

function createSseResponse(events: Record<string, unknown>[]) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        events.forEach((event) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        });
        controller.close();
      },
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
      },
    },
  );
}

function createHumanMessage(content: string) {
  return {
    content,
    _getType() {
      return 'human';
    },
  };
}

test('responses runtime posts to /responses with serialized input and streamed usage', async () => {
  const config = buildConfig({
    id: 'aliyun_responses',
    name: 'Aliyun Responses',
    baseUrl: 'https://dashscope.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1',
    models: ['qwen3.5-plus'],
    protocol: 'openai_responses_compatible',
  });

  const originalFetch = globalThis.fetch;
  const captured: { url?: string; body?: Record<string, any> } = {};
  globalThis.fetch = (async (input, init) => {
    captured.url = String(input);
    captured.body = JSON.parse(String(init?.body ?? '{}'));
    return createSseResponse([
      { type: 'response.reasoning_text.delta', delta: '先分析问题。' },
      { type: 'response.output_text.delta', delta: '这是答案。' },
      {
        type: 'response.completed',
        response: {
          id: 'resp_123',
          output_text: '这是答案。',
          usage: {
            input_tokens: 11,
            output_tokens: 7,
            total_tokens: 18,
          },
        },
      },
    ]);
  }) as typeof fetch;

  try {
    const runtime = createAgentRuntime({
      config,
      providerId: 'aliyun_responses',
      model: 'qwen3.5-plus',
      systemPrompt: 'You are a runtime test assistant.',
      enableTools: true,
      enableThinking: true,
      structuredOutput: { mode: 'text' },
      responsesTools: {
        webSearch: true,
      },
    });

    const events = [];
    for await (const event of runtime.stream({
      messages: [createHumanMessage('帮我总结这段内容')],
    })) {
      events.push(event);
    }

    assert.equal(captured.url, 'https://dashscope.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1/responses');
    assert.equal(captured.body?.enable_thinking, true);
    assert.deepEqual(captured.body?.tools, [{ type: 'web_search' }]);
    assert.equal(captured.body?.input?.[0]?.role, 'system');
    assert.equal(
      captured.body?.input?.[0]?.content,
      buildGroundedSystemPrompt('You are a runtime test assistant.'),
    );
    assert.equal(captured.body?.input?.[1]?.role, 'user');
    assert.deepEqual(captured.body?.input?.[1]?.content, [
      {
        type: 'input_text',
        text: '帮我总结这段内容',
      },
    ]);
    assert.deepEqual(events[0], { type: 'reasoning_delta', delta: '先分析问题。' });
    assert.equal(events[1]?.type, 'assistant_delta');
    assert.equal(events[1]?.delta, '这是答案。');
    assert.equal(events[2]?.type, 'assistant_message');
    assert.equal(events[2]?.content, '这是答案。');
    assert.deepEqual(events[2]?.tools, []);
    assert.deepEqual(events[2]?.usage, {
      inputTokens: 11,
      outputTokens: 7,
      totalTokens: 18,
    });
    assert.equal(events[1]?.messageId, events[2]?.messageId);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('responses runtime disables thinking when structured output is not plain text', async () => {
  const config = buildConfig({
    id: 'aliyun_responses',
    name: 'Aliyun Responses',
    baseUrl: 'https://dashscope.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1',
    models: ['qwen3.5-plus'],
    protocol: 'openai_responses_compatible',
  });

  const originalFetch = globalThis.fetch;
  const captured: { body?: Record<string, any> } = {};
  globalThis.fetch = (async (_input, init) => {
    captured.body = JSON.parse(String(init?.body ?? '{}'));
    return createSseResponse([
      {
        type: 'response.completed',
        response: {
          id: 'resp_456',
          output_text: '{"answer":"ok"}',
          usage: {
            input_tokens: 5,
            output_tokens: 3,
            total_tokens: 8,
          },
        },
      },
    ]);
  }) as typeof fetch;

  try {
    const runtime = createAgentRuntime({
      config,
      providerId: 'aliyun_responses',
      model: 'qwen3.5-plus',
      enableThinking: true,
      structuredOutput: {
        mode: 'json_schema',
        schema: '{"type":"object","properties":{"answer":{"type":"string"}},"required":["answer"]}',
      },
      responsesTools: {},
    });

    for await (const _event of runtime.stream({
      messages: [createHumanMessage('输出结构化 JSON')],
    })) {
      // consume stream
    }

    assert.equal(captured.body?.enable_thinking, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('responses runtime continues with previous_response_id after local function execution', async () => {
  const config = buildConfig({
    id: 'aliyun_responses',
    name: 'Aliyun Responses',
    baseUrl: 'https://dashscope.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1',
    models: ['qwen3.5-plus'],
    protocol: 'openai_responses_compatible',
  });

  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  const captured: Array<{ url: string; body: Record<string, any> }> = [];
  globalThis.fetch = (async (input, init) => {
    const request = {
      url: String(input),
      body: JSON.parse(String(init?.body ?? '{}')),
    };
    captured.push(request);

    if (captured.length === 1) {
      return createSseResponse([
        {
          type: 'response.output_item.done',
          item: {
            type: 'function_call',
            id: 'fc_123',
            call_id: 'call_123',
            name: 'search_knowledge_base',
            arguments: '{"query":"LangGraph runtime"}',
          },
        },
        {
          type: 'response.completed',
          response: {
            id: 'resp_789',
            output_text: '',
            usage: {
              input_tokens: 15,
              output_tokens: 4,
              total_tokens: 19,
            },
          },
        },
      ]);
    }

    return createSseResponse([
      { type: 'response.output_text.delta', delta: '工具结果已整合。' },
      {
        type: 'response.completed',
        response: {
          id: 'resp_790',
          output_text: '工具结果已整合。',
          usage: {
            input_tokens: 9,
            output_tokens: 6,
            total_tokens: 15,
          },
        },
      },
    ]);
  }) as typeof fetch;
  console.error = () => {};

  try {
    const runtime = createAgentRuntime({
      config,
      providerId: 'aliyun_responses',
      model: 'qwen3.5-plus',
      enableTools: true,
      responsesTools: {
        customFunctionCalling: true,
      },
    });

    const events = [];
    for await (const event of runtime.stream({
      messages: [createHumanMessage('查询一下 LangGraph runtime')],
    })) {
      events.push(event);
    }

    assert.equal(captured.length, 2);
    assert.equal(
      captured[0]?.url,
      'https://dashscope.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1/responses',
    );
    assert.equal(
      captured[1]?.url,
      'https://dashscope.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1/responses',
    );
    assert.equal(captured[1]?.body.previous_response_id, 'resp_789');
    assert.equal(captured[1]?.body.input?.[0]?.type, 'function_call_output');
    assert.equal(captured[1]?.body.input?.[0]?.call_id, 'call_123');
    assert.equal(typeof captured[1]?.body.input?.[0]?.output, 'string');
    assert.equal(events.some((event) => event.type === 'tool_event' && event.tool.name === 'search_knowledge_base'), true);
    assert.equal(events.at(-1)?.type, 'assistant_message');
    assert.equal(events.at(-1)?.content, '工具结果已整合。');
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
  }
});

test('langgraph runtime streams reasoning, assistant deltas and final usage for chat-compatible providers', async () => {
  const config = buildConfig({
    id: 'openai_chat',
    name: 'OpenAI Chat',
    baseUrl: 'https://api.example.com/v1',
    models: ['gpt-4.1'],
    protocol: 'openai_chat_compatible',
  });

  const originalInvoke = ChatOpenAI.prototype.invoke;
  const captured: { messages?: unknown[] } = {};
  ChatOpenAI.prototype.invoke = (async function invoke(messages: unknown[]) {
    captured.messages = messages;
    return new AIMessage({
      id: 'ai_langgraph_1',
      content: 'LangGraph 已返回最终答案。',
      additional_kwargs: {
        reasoning_content: '先整理上下文，再生成答案。',
      },
      response_metadata: {
        tokenUsage: {
          inputTokens: 13,
          outputTokens: 8,
          totalTokens: 21,
        },
      },
    });
  }) as typeof ChatOpenAI.prototype.invoke;

  try {
    const runtime = createAgentRuntime({
      config,
      providerId: 'openai_chat',
      model: 'gpt-4.1',
      systemPrompt: 'You are a LangGraph runtime test assistant.',
      enableTools: false,
      enableThinking: true,
      structuredOutput: { mode: 'text' },
    });

    const events = [];
    for await (const event of runtime.stream({
      messages: [new HumanMessage('解释一下当前流程')],
    })) {
      events.push(event);
    }

    assert.equal(Array.isArray(captured.messages), true);
    assert.equal((captured.messages?.[0] as { _getType?: () => string } | undefined)?._getType?.(), 'system');
    assert.equal(
      (captured.messages?.[0] as { content?: unknown } | undefined)?.content,
      buildGroundedSystemPrompt('You are a LangGraph runtime test assistant.', { enableTools: false }),
    );
    assert.equal((captured.messages?.[1] as { _getType?: () => string } | undefined)?._getType?.(), 'human');
    assert.deepEqual(events[0], { type: 'reasoning_delta', delta: '先整理上下文，再生成答案。' });
    assert.deepEqual(events[1], {
      type: 'assistant_delta',
      messageId: 'ai_langgraph_1',
      delta: 'LangGraph 已返回最终答案。',
    });
    assert.deepEqual(events[2], {
      type: 'assistant_message',
      messageId: 'ai_langgraph_1',
      content: 'LangGraph 已返回最终答案。',
      tools: [],
      usage: {
        inputTokens: 13,
        outputTokens: 8,
        totalTokens: 21,
      },
    });
  } finally {
    ChatOpenAI.prototype.invoke = originalInvoke;
  }
});

test('task graph compiler uses /responses payload for responses-compatible providers', async () => {
  const config = buildConfig({
    id: 'aliyun_responses',
    name: 'Aliyun Responses',
    baseUrl: 'https://dashscope.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1',
    models: ['qwen3.5-plus'],
    protocol: 'openai_responses_compatible',
  });

  const originalFetch = globalThis.fetch;
  const captured: { url?: string; body?: Record<string, any> } = {};
  globalThis.fetch = (async (input, init) => {
    captured.url = String(input);
    captured.body = JSON.parse(String(init?.body ?? '{}'));
    return new Response(
      JSON.stringify({
        output_text: JSON.stringify({
          title: 'FlowAgent workflow',
          summary: 'Plan tasks.',
          workers: [
            {
              title: 'Worker A',
              objective: 'Implement runtime slice',
              acceptanceCriteria: 'Tests pass',
            },
          ],
        }),
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }) as typeof fetch;

  try {
    const graph = await compileTaskGraphFromGoal({
      config,
      providerId: 'aliyun_responses',
      model: 'qwen3.5-plus',
      goal: '为 provider runtime 补核心集成测试',
    });

    assert.equal(captured.url, 'https://dashscope.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1/responses');
    assert.equal(captured.body?.text?.format?.type, 'json_schema');
    assert.equal(captured.body?.text?.format?.name, 'flowagent_task_plan');
    assert.equal(graph.compilerStrategy, 'llm');
    assert.equal(graph.nodes.some((node) => node.type === 'worker'), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('task graph compiler uses /chat/completions payload for chat-compatible providers', async () => {
  const config = buildConfig({
    id: 'openai_chat',
    name: 'OpenAI Chat',
    baseUrl: 'https://api.example.com/v1',
    models: ['gpt-4.1'],
    protocol: 'openai_chat_compatible',
  });

  const originalFetch = globalThis.fetch;
  const captured: { url?: string; body?: Record<string, any> } = {};
  globalThis.fetch = (async (input, init) => {
    captured.url = String(input);
    captured.body = JSON.parse(String(init?.body ?? '{}'));
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: 'FlowAgent workflow',
                summary: 'Plan tasks.',
                workers: [
                  {
                    title: 'Worker A',
                    objective: 'Implement runtime slice',
                    acceptanceCriteria: 'Tests pass',
                  },
                ],
              }),
            },
          },
        ],
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }) as typeof fetch;

  try {
    const graph = await compileTaskGraphFromGoal({
      config,
      providerId: 'openai_chat',
      model: 'gpt-4.1',
      goal: '为 provider runtime 补核心集成测试',
    });

    assert.equal(captured.url, 'https://api.example.com/v1/chat/completions');
    assert.equal(captured.body?.response_format?.type, 'json_schema');
    assert.equal(captured.body?.response_format?.json_schema?.name, 'flowagent_task_plan');
    assert.equal(graph.compilerStrategy, 'llm');
    assert.equal(graph.nodes.some((node) => node.type === 'worker'), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('task graph compiler falls back deterministically when provider request fails', async () => {
  const config = buildConfig({
    id: 'openai_chat',
    name: 'OpenAI Chat',
    baseUrl: 'https://api.example.com/v1',
    models: ['gpt-4.1'],
    protocol: 'openai_chat_compatible',
  });

  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  globalThis.fetch = (async () => {
    throw new Error('connect ECONNREFUSED');
  }) as typeof fetch;
  console.warn = () => {};

  try {
    const graph = await compileTaskGraphFromGoal({
      config,
      providerId: 'openai_chat',
      model: 'gpt-4.1',
      goal: '先查询日志；再生成修复建议。',
      title: 'Fallback Workflow',
    });

    assert.equal(graph.compilerStrategy, 'fallback');
    assert.equal(graph.title, 'Fallback Workflow');
    assert.ok(graph.nodes.some((node) => node.type === 'worker'));
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  }
});

test('task graph compiler falls back deterministically when the model returns invalid workflow JSON', async () => {
  const config = buildConfig({
    id: 'openai_chat',
    name: 'OpenAI Chat',
    baseUrl: 'https://api.example.com/v1',
    models: ['gpt-4.1'],
    protocol: 'openai_chat_compatible',
  });

  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const warnings: unknown[] = [];
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: '{"title":"Broken plan"',
            },
          },
        ],
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    )) as typeof fetch;
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };

  try {
    const graph = await compileTaskGraphFromGoal({
      config,
      providerId: 'openai_chat',
      model: 'gpt-4.1',
      goal: '把当前问题拆成几个可并行分支。',
      title: 'Broken Workflow',
    });

    assert.equal(graph.compilerStrategy, 'fallback');
    assert.equal(graph.title, 'Broken Workflow');
    assert.ok(graph.nodes.some((node) => node.type === 'worker'));
    assert.equal(warnings.length > 0, true);
    assert.match(String(warnings[0]?.[1] ?? ''), /The model returned invalid workflow JSON/);
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  }
});
