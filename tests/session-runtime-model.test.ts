import assert from 'node:assert/strict';
import test from 'node:test';

import localforage from 'localforage';

import {
  createQuickTopic,
  createTopic,
  getAgentMemoryContext,
  getTopicWorkspace,
  saveAgent,
  saveAgentMemoryDocument,
  updateTopicSessionSettings,
} from '../src/lib/agent-workspace';

const localforageState = new Map<string, unknown>();

localforage.getItem = async <T>(key: string) => (localforageState.has(key) ? (localforageState.get(key) as T) : null);
localforage.setItem = async <T>(key: string, value: T) => {
  localforageState.set(key, value);
  return value;
};
localforage.removeItem = async (key: string) => {
  localforageState.delete(key);
};

function createAgentId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

test('quick topics resolve to session-scoped runtime overrides with agent features disabled by default', async () => {
  localforageState.clear();
  const agentId = createAgentId('agent_session_runtime');
  const savedAgent = await saveAgent({
    id: agentId,
    name: 'Session Runtime Agent',
    description: 'Template agent for session runtime tests',
    systemPrompt: 'You are the template agent.',
    accentColor: 'from-emerald-500/20 to-teal-500/20',
    workspaceRelpath: `agents/${agentId}`,
  });

  const standardTopic = await createTopic({ agentId });
  const quickTopic = await createQuickTopic({
    agentId,
    title: 'Quick Chat',
    displayName: 'Travel Assistant',
    systemPromptOverride: 'You are a concise travel assistant.',
    providerIdOverride: 'openai',
    modelOverride: 'gpt-4o-mini',
  });

  const standardWorkspace = await getTopicWorkspace(standardTopic.id);
  const quickWorkspace = await getTopicWorkspace(quickTopic.id);

  assert.ok(standardWorkspace);
  assert.ok(quickWorkspace);

  assert.equal(standardWorkspace?.topic.sessionMode, 'agent');
  assert.equal(standardWorkspace?.runtime.sessionMode, 'agent');
  assert.equal(standardWorkspace?.runtime.displayName, savedAgent.name);
  assert.equal(standardWorkspace?.runtime.systemPrompt, savedAgent.systemPrompt);
  assert.equal(standardWorkspace?.runtime.enableMemory, true);
  assert.equal(standardWorkspace?.runtime.enableSkills, true);
  assert.equal(standardWorkspace?.runtime.enableTools, true);

  assert.equal(quickWorkspace?.topic.sessionMode, 'quick');
  assert.equal(quickWorkspace?.runtime.sessionMode, 'quick');
  assert.equal(quickWorkspace?.runtime.displayName, 'Travel Assistant');
  assert.equal(quickWorkspace?.runtime.systemPrompt, 'You are a concise travel assistant.');
  assert.equal(quickWorkspace?.runtime.providerId, 'openai');
  assert.equal(quickWorkspace?.runtime.model, 'gpt-4o-mini');
  assert.equal(quickWorkspace?.runtime.enableMemory, false);
  assert.equal(quickWorkspace?.runtime.enableSkills, false);
  assert.equal(quickWorkspace?.runtime.enableTools, false);
  assert.equal(quickWorkspace?.runtime.enableAgentSharedShortTerm, false);
});

test('agent memory context keeps session short-term isolated unless agent-shared short-term is enabled', async () => {
  localforageState.clear();
  const agentId = createAgentId('agent_session_memory');
  await saveAgent({
    id: agentId,
    name: 'Session Memory Agent',
    description: 'Agent used to verify session-vs-agent memory boundaries',
    systemPrompt: 'Be concise.',
    accentColor: 'from-blue-500/20 to-violet-500/20',
    workspaceRelpath: `agents/${agentId}`,
  });

  const topicA = await createTopic({ agentId, title: 'A 会话' });
  const topicB = await createTopic({ agentId, title: 'B 会话' });

  await saveAgentMemoryDocument({
    agentId,
    title: '长期偏好',
    content: '默认使用中文输出。',
    memoryScope: 'global',
    sourceType: 'promotion',
    importanceScore: 5,
  });
  await saveAgentMemoryDocument({
    agentId,
    title: '共享短期事项',
    content: '用户这周要准备一个发布说明。',
    memoryScope: 'daily',
    sourceType: 'conversation_log',
    eventDate: '2026-04-02',
  });
  await saveAgentMemoryDocument({
    agentId,
    title: 'A 会话短期事项',
    content: '用户明天要出差。',
    memoryScope: 'session',
    sourceType: 'conversation_log',
    topicId: topicA.id,
    eventDate: '2026-04-02',
  });

  const isolatedContext = await getAgentMemoryContext(agentId, {
    includeRecentMemorySnapshot: false,
    topicId: topicB.id,
    includeSessionMemory: true,
    includeAgentSharedShortTerm: false,
    now: '2026-04-02T12:00:00.000Z',
  });
  assert.match(isolatedContext, /长期偏好: 默认使用中文输出。/);
  assert.doesNotMatch(isolatedContext, /用户明天要出差。/);
  assert.doesNotMatch(isolatedContext, /用户这周要准备一个发布说明。/);

  const agentSharedContext = await getAgentMemoryContext(agentId, {
    includeRecentMemorySnapshot: false,
    topicId: topicB.id,
    includeSessionMemory: true,
    includeAgentSharedShortTerm: true,
    now: '2026-04-02T12:00:00.000Z',
  });
  assert.match(agentSharedContext, /共享短期事项: 用户这周要准备一个发布说明。/);
  assert.doesNotMatch(agentSharedContext, /用户明天要出差。/);

  const sameSessionContext = await getAgentMemoryContext(agentId, {
    includeRecentMemorySnapshot: false,
    topicId: topicA.id,
    includeSessionMemory: true,
    includeAgentSharedShortTerm: false,
    now: '2026-04-02T12:00:00.000Z',
  });
  assert.match(sameSessionContext, /A 会话短期事项: 用户明天要出差。/);
});

test('updateTopicSessionSettings persists topic-level runtime overrides without mutating the template agent', async () => {
  localforageState.clear();
  const agentId = createAgentId('agent_session_settings');
  await saveAgent({
    id: agentId,
    name: 'Session Settings Agent',
    description: 'Agent used to verify topic runtime updates',
    systemPrompt: 'Template system prompt.',
    accentColor: 'from-sky-500/20 to-cyan-500/20',
    workspaceRelpath: `agents/${agentId}`,
    providerId: 'openai',
    model: 'gpt-4o',
  });

  const topic = await createTopic({ agentId, title: '设置测试' });

  await updateTopicSessionSettings(topic.id, {
    displayName: 'Deal Desk',
    systemPromptOverride: 'You are a pricing copilot.',
    providerIdOverride: 'anthropic',
    modelOverride: 'claude-3-7-sonnet-latest',
    enableMemory: false,
    enableSkills: false,
    enableTools: true,
    enableAgentSharedShortTerm: true,
  });

  const updatedWorkspace = await getTopicWorkspace(topic.id);

  assert.ok(updatedWorkspace);
  assert.equal(updatedWorkspace?.topic.displayName, 'Deal Desk');
  assert.equal(updatedWorkspace?.topic.systemPromptOverride, 'You are a pricing copilot.');
  assert.equal(updatedWorkspace?.topic.providerIdOverride, 'anthropic');
  assert.equal(updatedWorkspace?.topic.modelOverride, 'claude-3-7-sonnet-latest');
  assert.equal(updatedWorkspace?.topic.enableMemory, false);
  assert.equal(updatedWorkspace?.topic.enableSkills, false);
  assert.equal(updatedWorkspace?.topic.enableTools, true);
  assert.equal(updatedWorkspace?.topic.enableAgentSharedShortTerm, true);

  assert.equal(updatedWorkspace?.runtime.displayName, 'Deal Desk');
  assert.equal(updatedWorkspace?.runtime.systemPrompt, 'You are a pricing copilot.');
  assert.equal(updatedWorkspace?.runtime.providerId, 'anthropic');
  assert.equal(updatedWorkspace?.runtime.model, 'claude-3-7-sonnet-latest');
  assert.equal(updatedWorkspace?.runtime.enableMemory, false);
  assert.equal(updatedWorkspace?.runtime.enableSkills, false);
  assert.equal(updatedWorkspace?.runtime.enableTools, true);
  assert.equal(updatedWorkspace?.runtime.enableAgentSharedShortTerm, true);

  await updateTopicSessionSettings(topic.id, {
    displayName: '',
    systemPromptOverride: '',
    providerIdOverride: '',
    modelOverride: '',
    enableMemory: true,
    enableSkills: true,
    enableTools: true,
    enableAgentSharedShortTerm: false,
  });

  const resetWorkspace = await getTopicWorkspace(topic.id);
  assert.ok(resetWorkspace);
  assert.equal(resetWorkspace?.topic.displayName, undefined);
  assert.equal(resetWorkspace?.topic.systemPromptOverride, undefined);
  assert.equal(resetWorkspace?.topic.providerIdOverride, undefined);
  assert.equal(resetWorkspace?.topic.modelOverride, undefined);
  assert.equal(resetWorkspace?.runtime.displayName, 'Session Settings Agent');
  assert.equal(resetWorkspace?.runtime.systemPrompt, 'Template system prompt.');
  assert.equal(resetWorkspace?.runtime.providerId, 'openai');
  assert.equal(resetWorkspace?.runtime.model, 'gpt-4o');
});
