import { StateGraph, MessagesAnnotation } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { AIMessage, SystemMessage, isAIMessageChunk } from '@langchain/core/messages';
import { createAgentTools } from './tools';
import { AgentConfig, resolveModelSelection } from './config';
import { getProviderRequestMode, normalizeBaseUrl } from '../provider-compatibility';

export interface AgentRuntimeOptions {
  config: AgentConfig;
  providerId?: string;
  model?: string;
  systemPrompt?: string;
  enableTools?: boolean;
  enableWebSearch?: boolean;
  searchProviderId?: string;
}

export interface AgentRuntimeInput {
  messages: any[];
}

export interface AgentRuntimeStreamOptions {
  signal?: AbortSignal;
}

export interface AgentToolResult {
  name: string;
  status: 'completed';
  result: string;
}

export type AgentRuntimeStreamEvent =
  | { type: 'assistant_delta'; messageId: string; delta: string }
  | { type: 'assistant_message'; messageId: string; content: string; tools: AgentToolResult[] }
  | { type: 'tool_event'; tool: AgentToolResult }
  | { type: 'reasoning_delta'; delta: string };

interface CompiledAgentRuntime {
  stream(
    input: AgentRuntimeInput,
    options?: AgentRuntimeStreamOptions,
  ): AsyncGenerator<AgentRuntimeStreamEvent, void, void>;
}

function stringifyMessageContent(content: unknown) {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((entry) => {
        if (typeof entry === 'string') {
          return entry;
        }
        if (typeof entry === 'object' && entry && 'text' in entry) {
          return String((entry as { text?: unknown }).text ?? '');
        }
        return JSON.stringify(entry);
      })
      .join('\n');
  }
  return String(content ?? '');
}

function extractToolUsage(messages: any[], initialCount: number) {
  const tools: AgentToolResult[] = [];
  for (let index = initialCount; index < messages.length; index += 1) {
    const message = messages[index];
    if (message?._getType?.() === 'tool') {
      const toolMessage = message as { name: string; content: unknown };
      tools.push({
        name: toolMessage.name,
        status: 'completed',
        result: String(toolMessage.content).slice(0, 1200),
      });
    }
  }
  return tools;
}

function buildResponseInput(messages: any[], systemPrompt: string) {
  const responseMessages: Array<{ role: string; content: string }> = [
    { role: 'system', content: systemPrompt },
  ];

  messages.forEach((message) => {
    const type = message?._getType?.();
    if (type === 'human') {
      responseMessages.push({
        role: 'user',
        content: stringifyMessageContent(message.content),
      });
      return;
    }
    if (type === 'ai') {
      responseMessages.push({
        role: 'assistant',
        content: stringifyMessageContent(message.content),
      });
    }
  });

  return responseMessages;
}

function buildResponseTools(config: AgentConfig, options: { enableTools: boolean; enableWebSearch: boolean }) {
  if (!options.enableTools) {
    return [];
  }

  const tools: Record<string, unknown>[] = [];

  if (options.enableWebSearch) {
    tools.push({ type: 'web_search' });
  }

  config.mcpServers
    .filter((server) => server.enabled && server.transport === 'sse' && server.url.trim())
    .forEach((server) => {
      let headers: Record<string, string> | undefined;
      if (server.headers.trim()) {
        try {
          headers = JSON.parse(server.headers);
        } catch {
          headers = undefined;
        }
      }
      tools.push({
        type: 'mcp',
        server_protocol: 'sse',
        server_label: server.name,
        server_description: server.description || `MCP server: ${server.name}`,
        server_url: server.url.trim(),
        ...(headers ? { headers } : {}),
      });
    });

  return tools;
}

async function* streamLangGraphRuntime(options: {
  graph: any;
  input: AgentRuntimeInput;
  signal?: AbortSignal;
}): AsyncGenerator<AgentRuntimeStreamEvent, void, void> {
  const stream = await options.graph.stream(
    { messages: options.input.messages },
    { streamMode: ['messages', 'values'], signal: options.signal },
  );

  let assistantDraftId = '';
  let finalMessages: any[] = [];
  let streamedAssistantContent = '';
  const initialCount = options.input.messages.length;

  for await (const chunk of stream) {
    if (!Array.isArray(chunk) || chunk.length < 2) {
      continue;
    }

    const [mode, payload] = chunk as unknown as [string, any];
    if (mode === 'values') {
      finalMessages = payload?.messages ?? finalMessages;
      continue;
    }

    if (mode !== 'messages' || !Array.isArray(payload)) {
      continue;
    }

    const [message] = payload;
    if (!message || message?._getType?.() !== 'ai') {
      continue;
    }

    if (typeof message.id === 'string' && message.id.trim()) {
      assistantDraftId = message.id;
    }

    const nextText = stringifyMessageContent(message.content);
    if (isAIMessageChunk(message)) {
      streamedAssistantContent += nextText;
      yield {
        type: 'assistant_delta',
        messageId: assistantDraftId || 'assistant_draft',
        delta: nextText,
      };
    } else {
      streamedAssistantContent = nextText;
      yield {
        type: 'assistant_delta',
        messageId: assistantDraftId || 'assistant_draft',
        delta: nextText,
      };
    }
  }

  const lastAssistantMessage = [...finalMessages]
    .reverse()
    .find((message) => message?._getType?.() === 'ai') as { id?: string; content: unknown } | undefined;

  if (!lastAssistantMessage) {
    throw new Error('The model did not return a final assistant message.');
  }

  const tools = extractToolUsage(finalMessages, initialCount);
  for (const tool of tools) {
    yield { type: 'tool_event', tool };
  }

  yield {
    type: 'assistant_message',
    messageId: lastAssistantMessage.id ?? (assistantDraftId || 'assistant_final'),
    content: stringifyMessageContent(lastAssistantMessage.content) || streamedAssistantContent,
    tools,
  };
}

async function* parseResponseSse(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';

    for (const frame of frames) {
      const lines = frame
        .split('\n')
        .map((line) => line.trimEnd())
        .filter(Boolean);
      const data = lines
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('\n');
      if (!data || data === '[DONE]') {
        continue;
      }

      yield JSON.parse(data) as Record<string, any>;
    }
  }

  const trailing = buffer.trim();
  if (!trailing) {
    return;
  }

  const data = trailing
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .join('\n');
  if (data && data !== '[DONE]') {
    yield JSON.parse(data) as Record<string, any>;
  }
}

function normalizeResponseToolName(type: string) {
  return type.replace(/_call$/, '');
}

function summarizeResponseToolEvent(item: Record<string, any>) {
  const type = typeof item.type === 'string' ? item.type : 'tool';
  return {
    name: normalizeResponseToolName(type),
    status: 'completed' as const,
    result: JSON.stringify(item).slice(0, 1200),
  };
}

async function* streamResponsesRuntime(options: {
  config: AgentConfig;
  provider: ReturnType<typeof resolveModelSelection>['provider'];
  model: string;
  systemPrompt: string;
  input: AgentRuntimeInput;
  signal?: AbortSignal;
  enableTools: boolean;
  enableWebSearch: boolean;
}): AsyncGenerator<AgentRuntimeStreamEvent, void, void> {
  const baseUrl = normalizeBaseUrl(options.provider.baseUrl);
  if (!baseUrl) {
    throw new Error(`${options.provider.name} base URL is missing. Please configure it in Settings.`);
  }
  if (!options.provider.apiKey) {
    throw new Error(`${options.provider.name} API key is missing. Please configure it in Settings.`);
  }

  const response = await fetch(`${baseUrl}/responses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.provider.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: options.model,
      input: buildResponseInput(options.input.messages, options.systemPrompt),
      stream: true,
      tools: buildResponseTools(options.config, {
        enableTools: options.enableTools,
        enableWebSearch: options.enableWebSearch,
      }),
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const message =
      (payload as any)?.error?.message ||
      (payload as any)?.message ||
      `HTTP ${response.status} ${response.statusText}`;
    throw new Error(message);
  }

  if (!response.body) {
    throw new Error('Responses API did not return a readable stream.');
  }

  const messageId = `response_${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`;
  let finalContent = '';
  const tools: AgentToolResult[] = [];

  for await (const event of parseResponseSse(response.body)) {
    const type = typeof event.type === 'string' ? event.type : '';
    if (type === 'response.output_text.delta') {
      const delta = String(event.delta ?? '');
      finalContent += delta;
      if (delta) {
        yield {
          type: 'assistant_delta',
          messageId,
          delta,
        };
      }
      continue;
    }

    if (type === 'response.reasoning_text.delta' || type === 'response.reasoning_summary_text.delta') {
      const delta = String(event.delta ?? '');
      if (delta) {
        yield { type: 'reasoning_delta', delta };
      }
      continue;
    }

    if (type === 'response.output_item.done' && event.item && typeof event.item === 'object') {
      const item = event.item as Record<string, any>;
      if (typeof item.type === 'string' && item.type.endsWith('_call')) {
        const tool = summarizeResponseToolEvent(item);
        tools.push(tool);
        yield { type: 'tool_event', tool };
      }
      continue;
    }

    if (type === 'response.completed') {
      const outputText = String(event.response?.output_text ?? '').trim();
      if (outputText) {
        finalContent = outputText;
      }
    }
  }

  yield {
    type: 'assistant_message',
    messageId,
    content: finalContent,
    tools,
  };
}

export function buildGroundedSystemPrompt(basePrompt: string, options?: { enableTools?: boolean }) {
  if (options?.enableTools === false) {
    return basePrompt;
  }

  return [
    basePrompt.trim(),
    'When using search_knowledge_base results, prefer claims backed by medium/high support.',
    'Cite document titles or source URIs when the answer depends on retrieved knowledge.',
    'If evidence is only low/unknown support, say the evidence is weak and avoid definitive claims.',
    'If retrieval stages are corrective or hybrid, treat them as useful but potentially less direct than strong primary evidence.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function createAgentRuntime(options: AgentRuntimeOptions): CompiledAgentRuntime {
  const {
    config,
    providerId,
    model,
    systemPrompt,
    enableTools = true,
    enableWebSearch = false,
    searchProviderId,
  } = options;
  const { provider, model: resolvedModel } = resolveModelSelection(config, providerId, model);
  const requestMode = getProviderRequestMode(provider.protocol);

  if (requestMode === 'responses') {
    return {
      stream: (input, streamOptions) =>
        streamResponsesRuntime({
          config,
          provider,
          model: resolvedModel,
          systemPrompt: buildGroundedSystemPrompt(systemPrompt || config.systemPrompt, { enableTools }),
          input,
          signal: streamOptions?.signal,
          enableTools,
          enableWebSearch,
        }),
    };
  }

  const agentTools = createAgentTools(config, {
    webSearchEnabled: enableWebSearch,
    searchProviderId,
  });

  let llm;
  if (provider.type === 'openai' || provider.type === 'custom_openai') {
    if (!provider.apiKey) {
      throw new Error(`${provider.name} API key is missing. Please configure it in Settings.`);
    }

    llm = new ChatOpenAI({
      apiKey: provider.apiKey,
      modelName: resolvedModel,
      temperature: 0,
      streaming: true,
      configuration: provider.baseUrl ? { baseURL: provider.baseUrl } : undefined,
    });
  } else if (provider.type === 'anthropic') {
    if (!provider.apiKey) {
      throw new Error(`${provider.name} API key is missing. Please configure it in Settings.`);
    }

    llm = new ChatAnthropic({
      apiKey: provider.apiKey,
      modelName: resolvedModel,
      temperature: 0,
      streaming: true,
      clientOptions: provider.baseUrl ? { baseURL: provider.baseUrl } : undefined,
    });
  } else {
    throw new Error(`Unsupported provider type: ${provider.type}`);
  }

  const modelWithTools = enableTools ? llm.bindTools(agentTools) : llm;

  const callModel = async (state: typeof MessagesAnnotation.State) => {
    const response = await modelWithTools.invoke([
      new SystemMessage(buildGroundedSystemPrompt(systemPrompt || config.systemPrompt, { enableTools })),
      ...state.messages,
    ]);
    return { messages: [response] };
  };

  const toolNode = new ToolNode(agentTools);

  const shouldContinue = (state: typeof MessagesAnnotation.State) => {
    const messages = state.messages;
    const lastMessage = messages[messages.length - 1] as AIMessage;
    if (lastMessage.tool_calls?.length) {
      return 'tools';
    }
    return '__end__';
  };

  const graph = new StateGraph(MessagesAnnotation).addNode('agent', callModel).addEdge('__start__', 'agent');
  const compiledGraph = enableTools
    ? graph
        .addNode('tools', toolNode)
        .addConditionalEdges('agent', shouldContinue)
        .addEdge('tools', 'agent')
        .compile()
    : graph.addEdge('agent', '__end__').compile();

  return {
    stream: (input, streamOptions) =>
      streamLangGraphRuntime({
        graph: compiledGraph,
        input,
        signal: streamOptions?.signal,
      }),
  };
}
