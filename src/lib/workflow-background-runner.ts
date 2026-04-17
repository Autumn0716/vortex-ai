import {
  getTopicWorkspace,
  runReadyWorkflowWorkerBranches,
} from './agent-workspace';
import type { TopicMessage } from './agent-workspace-types';
import { getAgentConfig } from './agent/config';

function buildRuntimeMessage(
  message: TopicMessage,
  messageConstructors: {
    AIMessage: new (content: string) => unknown;
    HumanMessage: new (content: string) => unknown;
  },
) {
  if (message.role === 'assistant') {
    return new messageConstructors.AIMessage(message.content);
  }

  const label =
    message.role === 'system'
      ? 'System context'
      : message.role === 'tool'
        ? 'Tool result'
        : 'User';
  return new messageConstructors.HumanMessage(`[${label}]\n${message.content}`);
}

export async function runWorkflowWorkerBranchesWithCurrentModel(options: {
  parentTopicId?: string;
  graphId?: string;
  maxWorkers?: number;
}) {
  const config = await getAgentConfig();

  return runReadyWorkflowWorkerBranches({
    parentTopicId: options.parentTopicId,
    graphId: options.graphId,
    maxWorkers: options.maxWorkers,
    executeWorker: async ({ branchWorkspace, node, graph }) => {
      const latestBranchWorkspace = await getTopicWorkspace(branchWorkspace.topic.id);
      if (!latestBranchWorkspace) {
        throw new Error('Workflow branch topic disappeared before execution.');
      }

      const [{ AIMessage, HumanMessage }, { createAgentRuntime }] = await Promise.all([
        import('@langchain/core/messages'),
        import('./agent/runtime'),
      ]);
      const modelFeatures = latestBranchWorkspace.runtime.modelFeatures;
      const runtime = createAgentRuntime({
        config,
        providerId: latestBranchWorkspace.runtime.providerId,
        model: latestBranchWorkspace.runtime.model,
        systemPrompt: [
          latestBranchWorkspace.runtime.systemPrompt,
          'You are executing one workflow worker branch in the background.',
          `Workflow: ${graph.title}`,
          `Workflow goal: ${graph.goal}`,
          `Worker objective: ${node.objective}`,
          `Acceptance criteria: ${node.acceptanceCriteria}`,
          'Return the concrete worker result only. Do not ask follow-up questions.',
        ]
          .filter(Boolean)
          .join('\n\n'),
        enableTools: latestBranchWorkspace.runtime.enableTools,
        enableThinking: modelFeatures.enableThinking,
        responsesTools: {
          ...modelFeatures.responsesTools,
          customFunctionCalling: modelFeatures.enableCustomFunctionCalling,
        },
        structuredOutput: modelFeatures.structuredOutput,
      });

      let finalContent = '';
      const messages = latestBranchWorkspace.messages.map((message) =>
        buildRuntimeMessage(message, { AIMessage, HumanMessage }),
      );
      for await (const event of runtime.stream({ messages })) {
        if (event.type === 'assistant_message') {
          finalContent = event.content;
        }
      }

      return {
        content: finalContent,
        handoffNote: `Background worker completed: ${node.title}`,
      };
    },
  });
}
