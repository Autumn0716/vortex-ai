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
}

export function createAgentRuntime(options: AgentRuntimeOptions) {
  const { config, providerId, model, systemPrompt } = options;
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

  const modelWithTools = llm.bindTools(agentTools);

  const callModel = async (state: typeof MessagesAnnotation.State) => {
    const response = await modelWithTools.invoke([
      new SystemMessage(systemPrompt || config.systemPrompt),
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

  return new StateGraph(MessagesAnnotation)
    .addNode('agent', callModel)
    .addNode('tools', toolNode)
    .addEdge('__start__', 'agent')
    .addConditionalEdges('agent', shouldContinue)
    .addEdge('tools', 'agent')
    .compile();
}
