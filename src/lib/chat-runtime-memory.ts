import type { AgentConfig } from './agent/config';
import type { TopicWorkspace } from './agent-workspace';

export function buildAgentMemoryContextRequest(
  workspaceSnapshot: TopicWorkspace,
  configSnapshot: AgentConfig,
  userContent: string,
) {
  if (!(workspaceSnapshot.runtime.enableMemory && configSnapshot.memory.enableAgentLongTerm)) {
    return null;
  }

  return {
    agentId: workspaceSnapshot.agent.id,
    options: {
      includeRecentMemorySnapshot: configSnapshot.memory.includeRecentMemorySnapshot,
      query: userContent,
      topicId: workspaceSnapshot.topic.id,
      includeSessionMemory: configSnapshot.memory.enableSessionMemory,
      includeAgentSharedShortTerm:
        workspaceSnapshot.runtime.enableAgentSharedShortTerm || configSnapshot.memory.enableAgentSharedShortTerm,
      tierPolicy: {
        hotRetentionDays: configSnapshot.memory.hotRetentionDays,
        warmRetentionDays: configSnapshot.memory.warmRetentionDays,
        coldRetentionDays: configSnapshot.memory.coldRetentionDays,
        coldMaxFiles: configSnapshot.memory.coldMaxFiles,
        protectedTopics: configSnapshot.memory.protectedTopics,
      },
    },
  };
}
