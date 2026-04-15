import { StateGraph, MessagesAnnotation } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { AIMessage, SystemMessage, isAIMessageChunk } from '@langchain/core/messages';
import { createAgentTools } from './tools';
import { AgentConfig, resolveModelSelection } from './config';
import { getProviderRequestMode, normalizeBaseUrl } from '../provider-compatibility';
import { z } from 'zod';

export interface AgentRuntimeOptions {
  config: AgentConfig;
  providerId?: string;
  model?: string;
  systemPrompt?: string;
  enableTools?: boolean;
  enableWebSearch?: boolean;
  searchProviderId?: string;
  enableThinking?: boolean;
  responsesTools?: {
    webSearch?: boolean;
    webSearchImage?: boolean;
    webExtractor?: boolean;
    codeInterpreter?: boolean;
    imageSearch?: boolean;
    mcp?: boolean;
    customFunctionCalling?: boolean;
  };
  structuredOutput?: {
    mode: 'text' | 'json_object' | 'json_schema';
    schema?: string;
  };
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

export interface AgentRuntimeUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export type AgentRuntimeStreamEvent =
  | { type: 'assistant_delta'; messageId: string; delta: string }
  | {
      type: 'assistant_message';
      messageId: string;
      content: string;
      tools: AgentToolResult[];
      usage?: AgentRuntimeUsage;
    }
  | { type: 'tool_event'; tool: AgentToolResult }
  | { type: 'reasoning_delta'; delta: string };

interface CompiledAgentRuntime {
  stream(
    input: AgentRuntimeInput,
    options?: AgentRuntimeStreamOptions,
  ): AsyncGenerator<AgentRuntimeStreamEvent, void, void>;
}

interface PendingResponseFunctionCall {
  name: string;
  callId: string;
  argumentsText: string;
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

function parseRuntimeJson<T>(raw: string, context: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    const preview = raw.trim().slice(0, 200) || '(empty JSON payload)';
    throw new Error(`${context}: ${preview}`, {
      cause: error instanceof Error ? error : undefined,
    });
  }
}

function extractUsageMetadata(payload: any): AgentRuntimeUsage | undefined {
  const usage = payload?.usage_metadata ?? payload?.usage ?? payload?.response_metadata?.tokenUsage ?? payload?.response_metadata?.usage;
  if (!usage || typeof usage !== 'object') {
    return undefined;
  }

  const inputTokens = Number(
    usage.input_tokens ?? usage.inputTokens ?? usage.prompt_tokens ?? usage.promptTokens ?? 0,
  );
  const outputTokens = Number(
    usage.output_tokens ?? usage.outputTokens ?? usage.completion_tokens ?? usage.completionTokens ?? 0,
  );
  const totalTokens = Number(usage.total_tokens ?? usage.totalTokens ?? inputTokens + outputTokens);

  if (!Number.isFinite(inputTokens) && !Number.isFinite(outputTokens) && !Number.isFinite(totalTokens)) {
    return undefined;
  }

  return {
    inputTokens: Number.isFinite(inputTokens) && inputTokens > 0 ? inputTokens : undefined,
    outputTokens: Number.isFinite(outputTokens) && outputTokens > 0 ? outputTokens : undefined,
    totalTokens: Number.isFinite(totalTokens) && totalTokens > 0 ? totalTokens : undefined,
  };
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
  const responseMessages: Array<{ role: string; content: unknown }> = [
    { role: 'system', content: systemPrompt },
  ];

  messages.forEach((message) => {
    const type = message?._getType?.();
    if (type === 'human') {
      const content = Array.isArray(message.content)
        ? message.content.map((entry: any) => {
            if (entry?.type === 'text') {
              return {
                type: 'input_text',
                text: String(entry.text ?? ''),
              };
            }
            if (entry?.type === 'image_url') {
              return {
                type: 'input_image',
                image_url: String(entry.image_url?.url ?? ''),
              };
            }
            return {
              type: 'input_text',
              text: stringifyMessageContent(entry),
            };
          })
        : [{ type: 'input_text', text: stringifyMessageContent(message.content) }];
      responseMessages.push({
        role: 'user',
        content,
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

export function buildResponseTools(
  config: AgentConfig,
  options: {
    enableTools: boolean;
    enableWebSearch: boolean;
    enableWebSearchImage?: boolean;
    enableWebExtractor?: boolean;
    enableCodeInterpreter?: boolean;
    enableImageSearch?: boolean;
    enableMcp?: boolean;
    customTools?: Array<{ name: string; description?: string; schema?: z.ZodTypeAny }>;
  },
) {
  if (!options.enableTools) {
    return [];
  }

  const tools: Record<string, unknown>[] = [];

  if (options.enableWebSearch) {
    tools.push({ type: 'web_search' });
  }
  if (options.enableWebSearchImage) {
    tools.push({ type: 'web_search_image' });
  }
  if (options.enableWebExtractor) {
    tools.push({ type: 'web_extractor' });
  }
  if (options.enableCodeInterpreter) {
    tools.push({ type: 'code_interpreter' });
  }
  if (options.enableImageSearch) {
    tools.push({ type: 'image_search' });
  }

  if (options.enableMcp) {
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
  }

  if (options.customTools?.length) {
    options.customTools.forEach((tool) => {
      const parameters =
        tool.schema && typeof z.toJSONSchema === 'function' ? z.toJSONSchema(tool.schema) : {};
      tools.push({
        type: 'function',
        name: tool.name,
        description: tool.description || tool.name,
        parameters,
      });
    });
  }

  return tools;
}

function parsePendingFunctionCall(item: Record<string, any>): PendingResponseFunctionCall | null {
  if (item.type !== 'function_call') {
    return null;
  }

  const name = typeof item.name === 'string' ? item.name.trim() : '';
  const callId =
    typeof item.call_id === 'string'
      ? item.call_id.trim()
      : typeof item.id === 'string'
        ? item.id.trim()
        : typeof item.tool_call_id === 'string'
          ? item.tool_call_id.trim()
          : '';
  if (!name || !callId) {
    return null;
  }

  return {
    name,
    callId,
    argumentsText:
      typeof item.arguments === 'string'
        ? item.arguments
        : item.arguments == null
          ? '{}'
          : JSON.stringify(item.arguments),
  };
}

async function executeResponseFunctionCall(
  toolMap: Map<string, any>,
  call: PendingResponseFunctionCall,
) {
  const tool = toolMap.get(call.name);
  if (!tool) {
    const errorPayload = `Tool "${call.name}" is not registered in the current runtime.`;
    return {
      toolEvent: {
        name: call.name,
        status: 'completed' as const,
        result: errorPayload,
      },
      outputItem: {
        type: 'function_call_output',
        call_id: call.callId,
        output: errorPayload,
      },
    };
  }

  let parsedArgs: unknown = {};
  try {
    parsedArgs = call.argumentsText.trim()
      ? parseRuntimeJson(call.argumentsText, `Failed to parse function call arguments for "${call.name}"`)
      : {};
  } catch (error) {
    const errorPayload = error instanceof Error ? error.message : String(error);
    return {
      toolEvent: {
        name: call.name,
        status: 'completed' as const,
        result: errorPayload,
      },
      outputItem: {
        type: 'function_call_output',
        call_id: call.callId,
        output: errorPayload,
      },
    };
  }

  let toolOutput: unknown;
  try {
    toolOutput = await tool.invoke(parsedArgs);
  } catch (error) {
    toolOutput = `Tool "${call.name}" failed: ${error instanceof Error ? error.message : String(error)}`;
  }

  const outputText = typeof toolOutput === 'string' ? toolOutput : JSON.stringify(toolOutput, null, 2);
  return {
    toolEvent: {
      name: call.name,
      status: 'completed' as const,
      result: outputText.slice(0, 1200),
    },
    outputItem: {
      type: 'function_call_output',
      call_id: call.callId,
      output: outputText,
    },
  };
}

export function buildChatModelKwargs(options: {
  enableThinking: boolean;
  structuredOutput?: AgentRuntimeOptions['structuredOutput'];
}) {
  const modelKwargs: Record<string, unknown> = {
    stream_options: {
      include_usage: true,
    },
  };

  if (options.enableThinking) {
    modelKwargs.extra_body = {
      enable_thinking: true,
    };
  }

  const structuredOutput = options.structuredOutput;
  if (!structuredOutput || structuredOutput.mode === 'text') {
    return modelKwargs;
  }

  if (structuredOutput.mode === 'json_object') {
    modelKwargs.response_format = {
      type: 'json_object',
    };
    return modelKwargs;
  }

  if (structuredOutput.mode === 'json_schema' && structuredOutput.schema?.trim()) {
    try {
      const parsedSchema = parseRuntimeJson(
        structuredOutput.schema,
        'Structured output schema is not valid JSON',
      );
      modelKwargs.response_format = {
        type: 'json_schema',
        json_schema: parsedSchema,
      };
    } catch (error) {
      throw error instanceof Error ? error : new Error('Structured output schema is not valid JSON.');
    }
  }

  return modelKwargs;
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

    const reasoningDelta =
      typeof message.additional_kwargs?.reasoning_content === 'string'
        ? message.additional_kwargs.reasoning_content
        : '';
    if (reasoningDelta) {
      yield {
        type: 'reasoning_delta',
        delta: reasoningDelta,
      };
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
  const usage = extractUsageMetadata(lastAssistantMessage);
  for (const tool of tools) {
    yield { type: 'tool_event', tool };
  }

  yield {
    type: 'assistant_message',
    messageId: lastAssistantMessage.id ?? (assistantDraftId || 'assistant_final'),
    content: stringifyMessageContent(lastAssistantMessage.content) || streamedAssistantContent,
    tools,
    usage,
  };
}

async function* parseResponseSse(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const parseFrame = (data: string) => {
    try {
      return JSON.parse(data) as Record<string, any>;
    } catch (error) {
      const preview = data.trim().slice(0, 200) || '(empty SSE payload)';
      throw new Error(`Failed to parse responses SSE payload: ${preview}`, {
        cause: error instanceof Error ? error : undefined,
      });
    }
  };

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

      yield parseFrame(data);
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
    yield parseFrame(data);
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
  enableThinking: boolean;
  enableWebSearch: boolean;
  searchProviderId?: string;
  responsesTools?: AgentRuntimeOptions['responsesTools'];
}): AsyncGenerator<AgentRuntimeStreamEvent, void, void> {
  const baseUrl = normalizeBaseUrl(options.provider.baseUrl);
  if (!baseUrl) {
    throw new Error(`${options.provider.name} base URL is missing. Please configure it in Settings.`);
  }
  if (!options.provider.apiKey) {
    throw new Error(`${options.provider.name} API key is missing. Please configure it in Settings.`);
  }

  const customTools =
    options.enableTools && options.responsesTools?.customFunctionCalling
      ? createAgentTools(options.config, {
          webSearchEnabled: options.enableWebSearch,
          searchProviderId: options.searchProviderId,
        })
      : [];
  const customToolMap = new Map(customTools.map((tool) => [tool.name, tool]));
  const messageId = `response_${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`;
  const tools: AgentToolResult[] = [];
  const baseRequest = {
    model: options.model,
    stream: true,
    stream_options: {
      include_usage: true,
    },
    enable_thinking: options.enableThinking,
    tools: buildResponseTools(options.config, {
      enableTools: options.enableTools,
      enableWebSearch: Boolean(options.responsesTools?.webSearch),
      enableWebSearchImage: Boolean(options.responsesTools?.webSearchImage),
      enableWebExtractor: Boolean(options.responsesTools?.webExtractor),
      enableCodeInterpreter: Boolean(options.responsesTools?.codeInterpreter),
      enableImageSearch: Boolean(options.responsesTools?.imageSearch),
      enableMcp: Boolean(options.responsesTools?.mcp),
      customTools: customTools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        schema: tool.schema,
      })),
    }),
  };

  let nextInput: unknown = buildResponseInput(options.input.messages, options.systemPrompt);
  let previousResponseId: string | undefined;
  let finalContent = '';
  let finalUsage: AgentRuntimeUsage | undefined;

  for (let step = 0; step < 6; step += 1) {
    const response = await fetch(`${baseUrl}/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.provider.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...baseRequest,
        input: nextInput,
        ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
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

    const pendingFunctionCalls: PendingResponseFunctionCall[] = [];
    let currentResponseId = previousResponseId;
    finalContent = '';

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
        const functionCall = parsePendingFunctionCall(item);
        if (functionCall) {
          pendingFunctionCalls.push(functionCall);
          continue;
        }
        if (typeof item.type === 'string' && item.type.endsWith('_call')) {
          const tool = summarizeResponseToolEvent(item);
          tools.push(tool);
          yield { type: 'tool_event', tool };
        }
        continue;
      }

      if (type === 'response.completed') {
        currentResponseId =
          typeof event.response?.id === 'string' && event.response.id.trim()
            ? event.response.id.trim()
            : currentResponseId;
        const outputText = String(event.response?.output_text ?? '').trim();
        if (outputText) {
          finalContent = outputText;
        }
        finalUsage = extractUsageMetadata(event.response);
      }
    }

    if (!pendingFunctionCalls.length) {
      yield {
        type: 'assistant_message',
        messageId,
        content: finalContent,
        tools,
        usage: finalUsage,
      };
      return;
    }

    if (!currentResponseId) {
      throw new Error('Responses API returned function calls without a response id.');
    }

    const toolOutputs = [];
    for (const call of pendingFunctionCalls) {
      const result = await executeResponseFunctionCall(customToolMap, call);
      tools.push(result.toolEvent);
      yield { type: 'tool_event', tool: result.toolEvent };
      toolOutputs.push(result.outputItem);
    }

    previousResponseId = currentResponseId;
    nextInput = toolOutputs;
  }

  throw new Error('Responses function calling exceeded the maximum continuation depth.');
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
    enableThinking = false,
    responsesTools,
    structuredOutput,
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
          enableThinking: Boolean(enableThinking && structuredOutput?.mode === 'text'),
          enableWebSearch,
          searchProviderId,
          responsesTools,
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
      modelKwargs: buildChatModelKwargs({
        enableThinking: Boolean(enableThinking && structuredOutput?.mode === 'text'),
        structuredOutput,
      }),
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
