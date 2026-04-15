import type { StoredToolRun } from './db';
import type { MemoryScope, MemorySourceType } from './agent-memory-model';
import type { MemoryRetrievalLayer } from './memory-lifecycle/query-router';
import type { CompiledTaskGraph, CompiledTaskGraphNode, TaskGraphCompilerStrategy } from './task-graph-compiler';

export interface AgentProfile {
  id: string;
  slug: string;
  name: string;
  description: string;
  systemPrompt: string;
  providerId?: string;
  model?: string;
  accentColor: string;
  workspaceRelpath: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TopicSummary {
  id: string;
  agentId: string;
  parentTopicId?: string;
  sessionMode: TopicSessionMode;
  displayName?: string;
  systemPromptOverride?: string;
  providerIdOverride?: string;
  modelOverride?: string;
  modelFeatures: TopicModelFeatures;
  enableMemory: boolean;
  enableSkills: boolean;
  enableTools: boolean;
  enableAgentSharedShortTerm: boolean;
  title: string;
  titleSource: 'auto' | 'manual';
  preview: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
  messageCount: number;
}

export interface TopicMessage {
  id: string;
  topicId: string;
  agentId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  authorName: string;
  content: string;
  createdAt: string;
  attachments?: TopicMessageAttachment[];
  tools?: StoredToolRun[];
}

export interface TopicMessageAttachment {
  id: string;
  kind: 'image';
  name: string;
  mimeType: string;
  dataUrl: string;
  sizeBytes: number;
}

export interface TopicMessageInput {
  id?: string;
  topicId: string;
  agentId: string;
  role: TopicMessage['role'];
  authorName: string;
  content: string;
  createdAt?: string;
  attachments?: TopicMessageAttachment[];
  tools?: StoredToolRun[];
}

export interface AgentMemoryDocument {
  id: string;
  agentId: string;
  title: string;
  content: string;
  memoryScope: MemoryScope;
  sourceType: MemorySourceType;
  importanceScore: number;
  topicId?: string;
  eventDate?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentMemorySearchResult extends AgentMemoryDocument {
  layer: MemoryRetrievalLayer;
  retrievalStage: 'preferred' | 'fallback' | 'semantic_cold';
  score: number;
}

export type TopicSessionMode = 'agent' | 'quick';

export interface TopicModelFeatures {
  enableThinking: boolean;
  enableCustomFunctionCalling: boolean;
  responsesTools: {
    webSearch: boolean;
    webSearchImage: boolean;
    webExtractor: boolean;
    codeInterpreter: boolean;
    imageSearch: boolean;
    mcp: boolean;
  };
  structuredOutput: {
    mode: 'text' | 'json_object' | 'json_schema';
    schema: string;
  };
}

export interface TopicRuntimeProfile {
  sessionMode: TopicSessionMode;
  displayName: string;
  systemPrompt: string;
  providerId?: string;
  model?: string;
  modelFeatures: TopicModelFeatures;
  enableMemory: boolean;
  enableSkills: boolean;
  enableTools: boolean;
  enableAgentSharedShortTerm: boolean;
}

export interface TopicWorkspace {
  agent: AgentProfile;
  topic: TopicSummary;
  runtime: TopicRuntimeProfile;
  messages: TopicMessage[];
  memoryDocuments: AgentMemoryDocument[];
  sessionSummary?: TopicSessionSummary;
}

export interface TopicSessionSummary {
  content: string;
  updatedAt: string;
  sourceMessageCount: number;
}

export interface TopicSessionSummaryBuilderInput {
  messages: TopicMessage[];
  historyWindow: number;
  tokenBudget?: number;
  deterministicSummary: { content: string; sourceMessageCount: number } | null;
}

export interface TopicTaskGraphNode extends CompiledTaskGraphNode {
  id: string;
  graphId: string;
  topicId: string;
  agentId: string;
  branchTopicId?: string;
  status: 'pending' | 'ready' | 'completed' | 'failed';
  createdAt: string;
  updatedAt: string;
}

export interface TopicTaskGraph {
  id: string;
  topicId: string;
  agentId: string;
  title: string;
  goal: string;
  summary: string;
  compilerProviderId?: string;
  compilerModel?: string;
  compilerStrategy: TaskGraphCompilerStrategy;
  status: 'draft' | 'ready' | 'review_ready' | 'failed';
  reviewerBranchTopicId?: string;
  createdAt: string;
  updatedAt: string;
  nodes: TopicTaskGraphNode[];
  edges: CompiledTaskGraph['edges'];
}

export interface WorkspaceSearchResult {
  type: 'topic' | 'message';
  topicId: string;
  agentId: string;
  agentName: string;
  topicTitle: string;
  preview: string;
  createdAt?: string;
}
