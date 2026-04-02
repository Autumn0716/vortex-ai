import { StateGraph, MessagesAnnotation } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { AIMessage, SystemMessage } from '@langchain/core/messages';
import { agentTools } from './tools';
import { AgentConfig, resolveModelSelection } from './config';

export interface AgentRuntimeOptions {
  config: AgentConfig;
  providerId?: string;
  model?: string;
  systemPrompt?: string;
  enableTools?: boolean;
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

export function createAgentRuntime(options: AgentRuntimeOptions) {
  const { config, providerId, model, systemPrompt, enableTools = true } = options;
  const { provider, model: resolvedModel } = resolveModelSelection(config, providerId, model);

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

  if (!enableTools) {
    return graph.addEdge('agent', '__end__').compile();
  }

  return graph.addNode('tools', toolNode).addConditionalEdges('agent', shouldContinue).addEdge('tools', 'agent').compile();
}
