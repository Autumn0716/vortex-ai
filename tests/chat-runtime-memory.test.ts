import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeAgentConfig } from '../src/lib/agent/config';
import { buildAgentMemoryContextRequest } from '../src/lib/chat-runtime-memory';
import { getDefaultTopicModelFeatures, type TopicWorkspace } from '../src/lib/agent-workspace';

function createWorkspace(overrides?: Partial<TopicWorkspace['runtime']>): TopicWorkspace {
  return {
    agent: {
      id: 'agent_vortex_core',
      slug: 'vortex-core',
      name: 'Vortex Core',
      description: 'Test agent',
      systemPrompt: 'System prompt',
      accentColor: 'from-blue-500/20 to-violet-500/20',
      workspaceRelpath: 'agents/vortex-core',
      isDefault: true,
      createdAt: '2026-04-14T00:00:00.000Z',
      updatedAt: '2026-04-14T00:00:00.000Z',
    },
    topic: {
      id: 'topic_memory_request',
      agentId: 'agent_vortex_core',
      title: 'Memory Request',
      titleSource: 'auto',
      preview: 'preview',
      createdAt: '2026-04-14T00:00:00.000Z',
      updatedAt: '2026-04-14T00:00:00.000Z',
      lastMessageAt: '2026-04-14T00:00:00.000Z',
      messageCount: 0,
      parentTopicId: undefined,
      sessionMode: 'agent',
      displayName: undefined,
      systemPromptOverride: undefined,
      providerIdOverride: undefined,
      modelOverride: undefined,
      enableMemory: true,
      enableSkills: true,
      enableTools: true,
      enableAgentSharedShortTerm: false,
      modelFeatures: getDefaultTopicModelFeatures(),
    },
    runtime: {
      sessionMode: 'agent',
      providerId: undefined,
      model: undefined,
      displayName: 'Vortex',
      systemPrompt: 'You are Vortex.',
      enableMemory: true,
      enableSkills: true,
      enableTools: true,
      enableAgentSharedShortTerm: false,
      modelFeatures: getDefaultTopicModelFeatures(),
      ...overrides,
    },
    messages: [],
    memoryDocuments: [],
    sessionSummary: null,
  };
}

test('buildAgentMemoryContextRequest forwards the current user content as query', () => {
  const config = normalizeAgentConfig({});
  const workspace = createWorkspace();
  const userContent = '2026-03-02 那天的 Gamma 方案是什么？';

  const request = buildAgentMemoryContextRequest(workspace, config, userContent);

  assert.ok(request);
  assert.equal(request?.agentId, 'agent_vortex_core');
  assert.equal(request?.options.query, userContent);
  assert.equal(request?.options.topicId, 'topic_memory_request');
  assert.equal(request?.options.includeSessionMemory, true);
});

test('buildAgentMemoryContextRequest enables shared short-term when topic override is on', () => {
  const config = normalizeAgentConfig({
    memory: {
      ...normalizeAgentConfig({}).memory,
      enableAgentSharedShortTerm: false,
    },
  });
  const workspace = createWorkspace({
    enableAgentSharedShortTerm: true,
  });

  const request = buildAgentMemoryContextRequest(workspace, config, 'query');

  assert.equal(request?.options.includeAgentSharedShortTerm, true);
});

test('buildAgentMemoryContextRequest returns null when memory injection is disabled for the topic', () => {
  const config = normalizeAgentConfig({});
  const workspace = createWorkspace({
    enableMemory: false,
  });

  const request = buildAgentMemoryContextRequest(workspace, config, 'query');

  assert.equal(request, null);
});
