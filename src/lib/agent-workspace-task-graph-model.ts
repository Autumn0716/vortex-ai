import type { CompiledTaskGraph, CompiledTaskGraphNode } from './task-graph-compiler';
import { warnJsonFallback } from './agent-workspace-model-features';
import type { TopicMessage, TopicSummary, TopicTaskGraph, TopicTaskGraphNode, TopicWorkspace } from './agent-workspace-types';

function formatBranchSnapshotLine(message: TopicMessage) {
  const label =
    message.role === 'user'
      ? 'User'
      : message.role === 'assistant'
        ? 'Assistant'
        : message.role === 'system'
          ? 'System'
          : 'Tool';
  return `- ${label}: ${message.content.replace(/\s+/g, ' ').trim().slice(0, 280)}`;
}

export function buildBranchBootstrapContent(
  workspace: TopicWorkspace,
  branchGoal: string | undefined,
  includeRecentMessages: number,
) {
  const recentMessages = workspace.messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .slice(-Math.max(0, includeRecentMessages))
    .map(formatBranchSnapshotLine);

  return [
    `Branched from topic: ${workspace.topic.title}`,
    `Branch goal: ${branchGoal?.trim() || 'Continue a focused follow-up task from the parent topic.'}`,
    'This is a child branch topic. Treat the parent topic and this branch as separate sessions after creation.',
    recentMessages.length ? `Recent parent context:\n${recentMessages.join('\n')}` : '',
    'Only rely on the snapshot above. Do not assume access to the full parent transcript unless it is explicitly included here.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function buildBranchHandoffContent(
  workspace: TopicWorkspace,
  note: string | undefined,
  includeRecentMessages: number,
) {
  const recentMessages = workspace.messages
    .filter((message) => message.role === 'assistant' || message.role === 'user')
    .slice(-Math.max(0, includeRecentMessages))
    .map(formatBranchSnapshotLine);

  return [
    `Branch handoff from: ${workspace.topic.title}`,
    note?.trim() ? `Handoff note: ${note.trim()}` : '',
    recentMessages.length ? `Recent branch findings:\n${recentMessages.join('\n')}` : '',
    'Review this handoff as a compact branch summary rather than a full transcript merge.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function buildTaskGraphCompiledMessage(
  graph: CompiledTaskGraph,
  branchTopics: Array<{ node: CompiledTaskGraphNode; topic: TopicSummary }>,
) {
  const workerLines = branchTopics.map(
    ({ node, topic }, index) =>
      `${index + 1}. ${node.title} -> ${topic.title}\n   Goal: ${node.objective}\n   Acceptance: ${node.acceptanceCriteria}`,
  );

  return [
    `Workflow compiled: ${graph.title}`,
    `Goal: ${graph.goal}`,
    `Summary: ${graph.summary}`,
    `Compiler strategy: ${graph.compilerStrategy}`,
    workerLines.length ? `Worker branches:\n${workerLines.join('\n')}` : 'Worker branches: none',
    'Use the generated worker branches to run focused subtasks in parallel, then merge or hand off the results.',
  ].join('\n\n');
}

export function buildWorkflowReviewReadyMessage(input: {
  graphTitle: string;
  graphGoal: string;
  workerNodes: TopicTaskGraphNode[];
}) {
  const workerLines = input.workerNodes.map(
    (node, index) => `${index + 1}. ${node.title}\n   Objective: ${node.objective}`,
  );

  return [
    `Workflow ready for review: ${input.graphTitle}`,
    `Goal: ${input.graphGoal}`,
    workerLines.length ? `Completed worker branches:\n${workerLines.join('\n')}` : '',
    'Next: review the branch handoffs in this parent topic and produce the merged answer.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export type TopicTaskGraphNodeRow = {
  id: string;
  graph_id: string;
  topic_id: string;
  agent_id: string;
  node_key: string;
  node_type: CompiledTaskGraphNode['type'];
  title: string;
  objective: string;
  acceptance_criteria: string;
  depends_on_json: string;
  branch_topic_id: string | null;
  status: TopicTaskGraphNode['status'];
  created_at: string;
  updated_at: string;
};

export type TopicTaskGraphRow = {
  id: string;
  topic_id: string;
  agent_id: string;
  title: string;
  goal: string;
  status: TopicTaskGraph['status'];
  reviewer_branch_topic_id: string | null;
  updated_at: string;
};

export function parseJsonArray<T>(value: string, context = 'JSON array'): T[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch (error) {
    warnJsonFallback(context, value, error);
    return [];
  }
}

export function toTopicTaskGraphNode(row: TopicTaskGraphNodeRow): TopicTaskGraphNode {
  return {
    id: row.id,
    graphId: row.graph_id,
    topicId: row.topic_id,
    agentId: row.agent_id,
    key: row.node_key,
    type: row.node_type,
    title: row.title,
    objective: row.objective,
    acceptanceCriteria: row.acceptance_criteria,
    dependsOn: parseJsonArray<string>(row.depends_on_json, `task graph dependencies for "${row.node_key}"`),
    branchTopicId: row.branch_topic_id ?? undefined,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
