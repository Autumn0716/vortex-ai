import assert from 'node:assert/strict';
import test from 'node:test';

import localforage from 'localforage';

import {
  addTopicMessages,
  buildTopicSessionSummary,
  compileTaskGraphFromTopic,
  createBranchTopicFromTopic,
  createQuickTopic,
  createTopic,
  getDefaultTopicModelFeatures,
  getAgentMemoryContext,
  getTopicWorkspace,
  handoffBranchTopicToParent,
  listTopics,
  retryWorkflowBranchTask,
  saveAgent,
  saveAgentMemoryDocument,
  updateTopicModelFeatures,
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

test('buildTopicSessionSummary only compresses dialogue outside the live history window', () => {
  const messages = [
    {
      id: 'm1',
      topicId: 'topic_summary',
      agentId: 'agent_summary',
      role: 'user' as const,
      authorName: 'You',
      content: '先梳理长期记忆方案。',
      createdAt: '2026-04-14T09:00:00.000Z',
    },
    {
      id: 'm2',
      topicId: 'topic_summary',
      agentId: 'agent_summary',
      role: 'assistant' as const,
      authorName: 'FlowAgent',
      content: '我先给出 memory/agents 目录结构。',
      createdAt: '2026-04-14T09:01:00.000Z',
    },
    {
      id: 'm3',
      topicId: 'topic_summary',
      agentId: 'agent_summary',
      role: 'user' as const,
      authorName: 'You',
      content: '记住：daily 需要更细粒度的 source log。',
      createdAt: '2026-04-14T09:02:00.000Z',
    },
    {
      id: 'm4',
      topicId: 'topic_summary',
      agentId: 'agent_summary',
      role: 'assistant' as const,
      authorName: 'FlowAgent',
      content: '我会保留附件、工具结果和任务状态。',
      createdAt: '2026-04-14T09:03:00.000Z',
    },
    {
      id: 'm5',
      topicId: 'topic_summary',
      agentId: 'agent_summary',
      role: 'user' as const,
      authorName: 'You',
      content: '下一步先做 session summary。',
      createdAt: '2026-04-14T09:04:00.000Z',
    },
    {
      id: 'm6',
      topicId: 'topic_summary',
      agentId: 'agent_summary',
      role: 'assistant' as const,
      authorName: 'FlowAgent',
      content: '好的，我先实现确定性摘要。',
      createdAt: '2026-04-14T09:05:00.000Z',
    },
    {
      id: 'm7',
      topicId: 'topic_summary',
      agentId: 'agent_summary',
      role: 'user' as const,
      authorName: 'You',
      content: '最近窗口里的新消息不应该再被压到摘要里。',
      createdAt: '2026-04-14T09:06:00.000Z',
    },
    {
      id: 'm8',
      topicId: 'topic_summary',
      agentId: 'agent_summary',
      role: 'assistant' as const,
      authorName: 'FlowAgent',
      content: '收到，最近消息继续保留原文。',
      createdAt: '2026-04-14T09:07:00.000Z',
    },
    {
      id: 'm9',
      topicId: 'topic_summary',
      agentId: 'agent_summary',
      role: 'user' as const,
      authorName: 'You',
      content: '后续还要补上删除和 handoff 后的摘要刷新。',
      createdAt: '2026-04-14T09:08:00.000Z',
    },
    {
      id: 'm10',
      topicId: 'topic_summary',
      agentId: 'agent_summary',
      role: 'assistant' as const,
      authorName: 'FlowAgent',
      content: '收到，最近消息继续保留原文。',
      createdAt: '2026-04-14T09:09:00.000Z',
    },
  ];

  const summary = buildTopicSessionSummary(messages, 2);

  assert.ok(summary);
  assert.equal(summary?.sourceMessageCount, 10);
  assert.match(summary?.content ?? '', /Compressed summary from 8 earlier turns/);
  assert.match(summary?.content ?? '', /记住：daily 需要更细粒度的 source log/);
  assert.doesNotMatch(summary?.content ?? '', /后续还要补上删除和 handoff 后的摘要刷新/);
});

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
  assert.deepEqual(quickWorkspace?.runtime.modelFeatures, getDefaultTopicModelFeatures());
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

test('topic model features persist and branch topics inherit them', async () => {
  localforageState.clear();
  const agentId = createAgentId('agent_model_features');
  await saveAgent({
    id: agentId,
    name: 'Model Feature Agent',
    description: 'Agent used to verify persisted model feature settings',
    systemPrompt: 'Template prompt.',
    accentColor: 'from-violet-500/20 to-indigo-500/20',
    workspaceRelpath: `agents/${agentId}`,
    providerId: 'dashscope',
    model: 'qwen-plus',
  });

  const topic = await createTopic({ agentId, title: 'Qwen Runtime' });
  await updateTopicModelFeatures(topic.id, {
    enableThinking: true,
    enableCustomFunctionCalling: true,
    responsesTools: {
      webSearch: true,
      webSearchImage: false,
      webExtractor: true,
      codeInterpreter: true,
      imageSearch: false,
      mcp: true,
    },
    structuredOutput: {
      mode: 'json_schema',
      schema: '{"type":"object","properties":{"answer":{"type":"string"}},"required":["answer"]}',
    },
  });

  const updatedWorkspace = await getTopicWorkspace(topic.id);
  assert.ok(updatedWorkspace);
  assert.equal(updatedWorkspace?.runtime.modelFeatures.enableThinking, true);
  assert.equal(updatedWorkspace?.runtime.modelFeatures.enableCustomFunctionCalling, true);
  assert.equal(updatedWorkspace?.runtime.modelFeatures.responsesTools.webSearch, true);
  assert.equal(updatedWorkspace?.runtime.modelFeatures.responsesTools.webExtractor, true);
  assert.equal(updatedWorkspace?.runtime.modelFeatures.responsesTools.codeInterpreter, true);
  assert.equal(updatedWorkspace?.runtime.modelFeatures.responsesTools.mcp, true);
  assert.equal(updatedWorkspace?.runtime.modelFeatures.structuredOutput.mode, 'json_schema');

  const branchTopic = await createBranchTopicFromTopic({
    sourceTopicId: topic.id,
    title: 'Qwen Runtime · Branch',
  });
  const branchWorkspace = await getTopicWorkspace(branchTopic.id);
  assert.ok(branchWorkspace);
  assert.deepEqual(branchWorkspace?.runtime.modelFeatures, updatedWorkspace?.runtime.modelFeatures);
});

test('branch topics inherit runtime settings but keep isolated follow-up context', async () => {
  localforageState.clear();
  const agentId = createAgentId('agent_topic_branch');
  await saveAgent({
    id: agentId,
    name: 'Branching Agent',
    description: 'Agent used to verify topic branching',
    systemPrompt: 'Template prompt.',
    accentColor: 'from-fuchsia-500/20 to-rose-500/20',
    workspaceRelpath: `agents/${agentId}`,
    providerId: 'openai',
    model: 'gpt-4.1',
  });

  const parentTopic = await createTopic({
    agentId,
    title: 'Parent Thread',
    displayName: 'Deal Desk',
    systemPromptOverride: 'You are a focused deal desk copilot.',
    providerIdOverride: 'anthropic',
    modelOverride: 'claude-3-7-sonnet-latest',
    enableMemory: false,
    enableSkills: true,
    enableTools: false,
    enableAgentSharedShortTerm: true,
  });

  await addTopicMessages([
    {
      topicId: parentTopic.id,
      agentId,
      role: 'user',
      authorName: 'You',
      content: 'We need a pricing options summary for the enterprise plan.',
    },
    {
      topicId: parentTopic.id,
      agentId,
      role: 'assistant',
      authorName: 'Deal Desk',
      content: 'Current options are annual commit, ramp plan, and pilot-to-paid conversion.',
    },
  ]);

  const branchTopic = await createBranchTopicFromTopic({
    sourceTopicId: parentTopic.id,
    title: 'Pricing branch',
    branchGoal: 'Draft only the pilot-to-paid recommendation.',
    includeRecentMessages: 4,
  });

  const branchWorkspace = await getTopicWorkspace(branchTopic.id);
  const refreshedParent = await getTopicWorkspace(parentTopic.id);

  assert.ok(branchWorkspace);
  assert.ok(refreshedParent);
  assert.equal(branchWorkspace?.topic.parentTopicId, parentTopic.id);
  assert.equal(branchWorkspace?.runtime.displayName, 'Deal Desk');
  assert.equal(branchWorkspace?.runtime.systemPrompt, 'You are a focused deal desk copilot.');
  assert.equal(branchWorkspace?.runtime.providerId, 'anthropic');
  assert.equal(branchWorkspace?.runtime.model, 'claude-3-7-sonnet-latest');
  assert.equal(branchWorkspace?.runtime.enableMemory, false);
  assert.equal(branchWorkspace?.runtime.enableSkills, true);
  assert.equal(branchWorkspace?.runtime.enableTools, false);
  assert.equal(branchWorkspace?.runtime.enableAgentSharedShortTerm, true);
  assert.equal(branchWorkspace?.messages.length, 1);
  assert.equal(branchWorkspace?.messages[0]?.role, 'system');
  assert.match(branchWorkspace?.messages[0]?.content ?? '', /Branched from topic: Parent Thread/);
  assert.match(branchWorkspace?.messages[0]?.content ?? '', /pilot-to-paid recommendation/);
  assert.match(branchWorkspace?.messages[0]?.content ?? '', /pricing options summary/i);
  assert.equal(refreshedParent?.messages.length, 2);
});

test('branch topics can hand off findings back to the parent topic', async () => {
  localforageState.clear();
  const agentId = createAgentId('agent_branch_handoff');
  await saveAgent({
    id: agentId,
    name: 'Handoff Agent',
    description: 'Agent used to verify branch handoff',
    systemPrompt: 'Template prompt.',
    accentColor: 'from-cyan-500/20 to-blue-500/20',
    workspaceRelpath: `agents/${agentId}`,
  });

  const parentTopic = await createTopic({ agentId, title: 'Main Thread' });
  await addTopicMessages([
    {
      topicId: parentTopic.id,
      agentId,
      role: 'user',
      authorName: 'You',
      content: 'Work out the implementation plan.',
    },
  ]);

  const branchTopic = await createBranchTopicFromTopic({
    sourceTopicId: parentTopic.id,
    title: 'Implementation branch',
    branchGoal: 'Produce the rollout steps only.',
  });

  await addTopicMessages([
    {
      topicId: branchTopic.id,
      agentId,
      role: 'assistant',
      authorName: 'Handoff Agent',
      content: 'Step 1 is schema migration. Step 2 is UI wiring. Step 3 is regression testing.',
    },
  ]);

  await handoffBranchTopicToParent({
    branchTopicId: branchTopic.id,
    note: 'Return only the rollout summary.',
    includeRecentMessages: 4,
  });

  const parentWorkspace = await getTopicWorkspace(parentTopic.id);
  const branchWorkspace = await getTopicWorkspace(branchTopic.id);

  assert.ok(parentWorkspace);
  assert.ok(branchWorkspace);
  assert.equal(parentWorkspace?.messages.length, 2);
  assert.equal(parentWorkspace?.messages[1]?.role, 'assistant');
  assert.match(parentWorkspace?.messages[1]?.authorName ?? '', /Branch/);
  assert.match(parentWorkspace?.messages[1]?.content ?? '', /Branch handoff from: Implementation branch/);
  assert.match(parentWorkspace?.messages[1]?.content ?? '', /Return only the rollout summary/);
  assert.match(parentWorkspace?.messages[1]?.content ?? '', /schema migration/i);

  const lastBranchMessage = branchWorkspace?.messages[branchWorkspace.messages.length - 1];
  assert.equal(lastBranchMessage?.role, 'system');
  assert.match(lastBranchMessage?.content ?? '', /Sent a branch handoff to parent topic "Main Thread"/);
});

test('workflow branch handoff marks the matching worker node completed', async () => {
  localforageState.clear();
  const agentId = createAgentId('agent_workflow_handoff');
  await saveAgent({
    id: agentId,
    name: 'Workflow Agent',
    description: 'Agent used to verify workflow status handoff',
    systemPrompt: 'Template prompt.',
    accentColor: 'from-amber-500/20 to-orange-500/20',
    workspaceRelpath: `agents/${agentId}`,
  });

  const parentTopic = await createTopic({ agentId, title: 'Workflow Parent' });
  const graphResult = await compileTaskGraphFromTopic({
    sourceTopicId: parentTopic.id,
    title: 'Workflow Status Test',
    goal: '实现 schema 状态推进；补充回归测试',
  });
  const branchTopic = graphResult.branchTopics[0];
  assert.ok(branchTopic);

  await addTopicMessages([
    {
      topicId: branchTopic.id,
      agentId,
      role: 'assistant',
      authorName: 'Workflow Agent',
      content: 'Worker result is ready for parent review.',
    },
  ]);

  const handoffResult = await handoffBranchTopicToParent({
    branchTopicId: branchTopic.id,
    note: 'Worker branch completed.',
    includeRecentMessages: 3,
  });

  assert.equal(handoffResult.completedTaskNodes.length, 1);
  assert.equal(handoffResult.completedTaskNodes[0]?.branchTopicId, branchTopic.id);
  assert.equal(handoffResult.completedTaskNodes[0]?.status, 'completed');
});

test('workflow writes a review-ready rollup after all worker branches hand off', async () => {
  localforageState.clear();
  const agentId = createAgentId('agent_workflow_rollup');
  await saveAgent({
    id: agentId,
    name: 'Workflow Rollup Agent',
    description: 'Agent used to verify workflow rollups',
    systemPrompt: 'Template prompt.',
    accentColor: 'from-lime-500/20 to-emerald-500/20',
    workspaceRelpath: `agents/${agentId}`,
  });

  const parentTopic = await createTopic({ agentId, title: 'Workflow Rollup Parent' });
  const graphResult = await compileTaskGraphFromTopic({
    sourceTopicId: parentTopic.id,
    title: 'Workflow Rollup Test',
    goal: '实现 dispatcher 状态推进；补充 reviewer 汇总提示',
  });
  assert.equal(graphResult.branchTopics.length, 2);

  await addTopicMessages([
    {
      topicId: graphResult.branchTopics[0]!.id,
      agentId,
      role: 'assistant',
      authorName: 'Workflow Rollup Agent',
      content: 'Dispatcher status branch is complete.',
    },
    {
      topicId: graphResult.branchTopics[1]!.id,
      agentId,
      role: 'assistant',
      authorName: 'Workflow Rollup Agent',
      content: 'Reviewer summary branch is complete.',
    },
  ]);

  const firstHandoff = await handoffBranchTopicToParent({
    branchTopicId: graphResult.branchTopics[0]!.id,
    note: 'First worker done.',
    includeRecentMessages: 2,
  });
  assert.equal(firstHandoff.reviewReadyWorkflows.length, 0);

  const secondHandoff = await handoffBranchTopicToParent({
    branchTopicId: graphResult.branchTopics[1]!.id,
    note: 'Second worker done.',
    includeRecentMessages: 2,
  });
  assert.equal(secondHandoff.reviewReadyWorkflows.length, 1);
  assert.equal(secondHandoff.reviewReadyWorkflows[0]?.title, 'Workflow Rollup Test');
  assert.equal(secondHandoff.reviewReadyWorkflows[0]?.workerNodes.length, 2);
  const reviewerBranchTopic = secondHandoff.reviewReadyWorkflows[0]?.reviewerBranchTopic;
  assert.ok(reviewerBranchTopic);
  assert.equal(reviewerBranchTopic.parentTopicId, parentTopic.id);

  const repeatedHandoff = await handoffBranchTopicToParent({
    branchTopicId: graphResult.branchTopics[1]!.id,
    note: 'Repeated handoff should not create a second review-ready rollup.',
    includeRecentMessages: 2,
  });
  assert.equal(repeatedHandoff.reviewReadyWorkflows.length, 0);

  const allTopicsAfterRepeat = await listTopics(agentId);
  assert.equal(allTopicsAfterRepeat.filter((topic) => topic.title === 'Workflow Rollup Test · Reviewer').length, 1);

  const parentWorkspace = await getTopicWorkspace(parentTopic.id);
  assert.ok(parentWorkspace);
  const rollupMessages =
    parentWorkspace?.messages.filter(
      (message) =>
        message.role === 'system' &&
        message.authorName === 'Workflow Reviewer' &&
        /Workflow ready for review: Workflow Rollup Test/.test(message.content),
    ) ?? [];
  assert.equal(rollupMessages.length, 1);
  assert.match(rollupMessages[0]?.content ?? '', /Completed worker branches/);
  assert.match(rollupMessages[0]?.content ?? '', /Next: review the branch handoffs/);

  const reviewerWorkspace = await getTopicWorkspace(reviewerBranchTopic.id);
  assert.ok(reviewerWorkspace);
  assert.equal(reviewerWorkspace?.topic.title, 'Workflow Rollup Test · Reviewer');
  assert.equal(reviewerWorkspace?.messages[0]?.role, 'system');
  assert.match(reviewerWorkspace?.messages[0]?.content ?? '', /Review the completed worker branch handoffs/);

  const retryResult = await retryWorkflowBranchTask({
    branchTopicId: graphResult.branchTopics[0]!.id,
    reason: 'First worker output needs another pass.',
  });
  assert.equal(retryResult.previousBranchTopic.id, graphResult.branchTopics[0]!.id);
  assert.equal(retryResult.retriedTaskNode.status, 'ready');
  assert.equal(retryResult.retriedTaskNode.branchTopicId, retryResult.retryBranchTopic.id);
  assert.match(retryResult.retryBranchTopic.title, /Retry$/);

  const oldBranchAfterRetry = await getTopicWorkspace(graphResult.branchTopics[0]!.id);
  assert.match(oldBranchAfterRetry?.messages.at(-1)?.content ?? '', /Retried workflow task/);

  await addTopicMessages([
    {
      topicId: retryResult.retryBranchTopic.id,
      agentId,
      role: 'assistant',
      authorName: 'Workflow Rollup Agent',
      content: 'Retried dispatcher branch is complete.',
    },
  ]);
  const retryHandoff = await handoffBranchTopicToParent({
    branchTopicId: retryResult.retryBranchTopic.id,
    note: 'Retry branch complete.',
    includeRecentMessages: 2,
  });
  assert.equal(retryHandoff.reviewReadyWorkflows.length, 1);
  assert.notEqual(retryHandoff.reviewReadyWorkflows[0]?.reviewerBranchTopic?.id, reviewerBranchTopic.id);
});
