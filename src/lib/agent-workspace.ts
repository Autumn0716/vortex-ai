import localforage from 'localforage';
import { getAgentConfig } from './agent/config';
import type { Database, StoredToolRun } from './db';
import { buildEmbeddingConfigFromDocuments, initDB, parseEmbeddingJson, saveDB } from './db';
import {
  buildAgentWorkspacePath,
  buildMigratedTopicTitle,
  DEFAULT_TOPIC_PREVIEW,
  DEFAULT_TOPIC_TITLE,
  formatTopicPreview,
} from './agent-workspace-model';
import {
  listAgentsInDatabase,
  listTopicsInDatabase,
  saveAgentInDatabase,
} from './agent-workspace-directory';
import {
  getActiveAgentIdFromStore,
  getActiveTopicIdFromStore,
  resolveAgentIdForMemorySync,
  setActiveAgentIdInStore,
  setActiveTopicIdInStore,
} from './agent-workspace-navigation';
import {
  ensureAgentWorkspaceDatabase,
  getAgentWorkspaceSearchCapabilities,
  isAgentWorkspaceFtsAvailable,
  persistAndMaybeRebuildWorkspaceFts,
} from './agent-workspace-bootstrap';
import { ensureAgentWorkspaceSchema } from './agent-workspace-schema';
import {
  buildLayeredMemoryContextSnapshot,
  buildConversationMemoryEntry,
  buildMemoryPromotionTitle,
  buildPromotionFingerprint,
  scoreMemoryImportance,
  selectEffectiveMemoryDocuments,
  shouldPromoteMemory,
  type MemoryScope,
  type MemorySourceType,
} from './agent-memory-model';
import {
  countNonGlobalMemoryDocuments,
  getMemoryDocumentLayer,
  mergeDistinctMemorySearchResults,
  resolveMemoryEmbeddingConfig,
  routeMemoryQuery,
  scoreMemorySearchResult,
  searchColdMemoryVectorDocuments,
  selectMemoryDocumentsByLayers,
  toMemorySearchResults,
} from './agent-memory-search';
import type { MemoryRetrievalLayer } from './memory-lifecycle/query-router';
import { getAgentMemoryFileStore, syncAgentMemoryFromStore } from './agent-memory-sync';
import { createEmbeddings, type EmbeddingProviderConfig } from './embedding-client';
import {
  compileTaskGraphFromGoal,
  type CompiledTaskGraphNode,
} from './task-graph-compiler';
import { createFts5Tables } from './db-fts5-helpers';
import { runDatabaseTransaction } from './db-transaction';
import { buildLikePatterns, buildMatchQuery, getScalar, mapRows } from './agent-workspace-queries';
import { normalizeTopicModelFeatures } from './agent-workspace-model-features';
import { buildTopicSessionSummary } from './agent-workspace-session-summary';
import {
  fetchTopicSummaryById,
  getAgentRow,
  resolveTopicRuntimeProfile,
  toAgentMemoryDocument,
  toAgentProfile,
  toTopicMessage,
  toTopicSummary,
} from './agent-workspace-read-model';
import {
  buildBranchBootstrapContent,
  buildBranchHandoffContent,
  buildTaskGraphCompiledMessage,
  buildWorkflowReviewReadyMessage,
  toTopicTaskGraphNode,
  type TopicTaskGraphNodeRow,
  type TopicTaskGraphRow,
} from './agent-workspace-task-graph-model';
import type {
  AgentMemoryDocument,
  AgentMemorySearchResult,
  AgentProfile,
  TopicMessage,
  TopicMessageAttachment,
  TopicMessageInput,
  TopicModelFeatures,
  TopicRuntimeProfile,
  TopicSessionMode,
  TopicSessionSummary,
  TopicSessionSummaryBuilderInput,
  TopicSummary,
  TopicTaskGraph,
  TopicTaskGraphNode,
  TopicWorkspace,
  WorkspaceSearchResult,
} from './agent-workspace-types';

export type {
  AgentMemoryDocument,
  AgentMemorySearchResult,
  AgentProfile,
  TopicMessage,
  TopicMessageAttachment,
  TopicMessageInput,
  TopicModelFeatures,
  TopicRuntimeProfile,
  TopicSessionMode,
  TopicSessionSummary,
  TopicSessionSummaryBuilderInput,
  TopicSummary,
  TopicTaskGraph,
  TopicTaskGraphNode,
  TopicWorkspace,
  WorkspaceSearchResult,
} from './agent-workspace-types';
export { getDefaultTopicModelFeatures } from './agent-workspace-model-features';
export { buildTopicSessionSummary } from './agent-workspace-session-summary';

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `${prefix}_${uuid ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
}

function normalizeNullableOverride(value: string | undefined, fallback?: string) {
  if (value === undefined) {
    return fallback ?? null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

export async function syncCurrentAgentMemory(options?: {
  database?: Database;
  agentId?: string | null;
  fileStore?: ReturnType<typeof getAgentMemoryFileStore>;
  now?: string;
  persist?: boolean;
  strict?: boolean;
}) {
  const database = options?.database ?? (await ensureAgentSchema());
  const fileStore = options?.fileStore ?? getAgentMemoryFileStore();
  if (!fileStore) {
    return null;
  }

  const resolvedAgentId = await resolveAgentIdForMemorySync(database, options?.agentId);
  if (!resolvedAgentId) {
    return null;
  }

  const agent = getAgentRow(database, resolvedAgentId);
  if (!agent) {
    return null;
  }

  let result = null;
  try {
    result = await syncAgentMemoryFromStore(database, {
      agentId: agent.id,
      agentSlug: agent.slug,
      fileStore,
      now: options?.now,
    });
  } catch (error) {
    if (options?.strict) {
      throw error;
    }

    console.warn(`Skipping agent memory file sync for ${agent.slug}:`, error);
    return null;
  }

  if (result.changed && (options?.persist ?? !options?.database)) {
    await saveDB();
  }

  return result;
}

async function ensureAgentSchema(): Promise<Database> {
  return ensureAgentWorkspaceDatabase({
    initDB,
    saveDB,
    syncCurrentAgentMemory,
  });
}

async function persistAndMaybeRebuildFts(database: Database) {
  await persistAndMaybeRebuildWorkspaceFts(database, saveDB);
}

export async function getSearchCapabilities() {
  return getAgentWorkspaceSearchCapabilities(ensureAgentSchema);
}

export async function listAgents(): Promise<AgentProfile[]> {
  const database = await ensureAgentSchema();
  return listAgentsInDatabase(database);
}

export async function saveAgent(
  draft: Omit<AgentProfile, 'slug' | 'workspaceRelpath' | 'createdAt' | 'updatedAt' | 'isDefault'> & {
    isDefault?: boolean;
    workspaceRelpath?: string;
  },
): Promise<AgentProfile> {
  const database = await ensureAgentSchema();
  const agent = await saveAgentInDatabase(database, draft);
  await persistAndMaybeRebuildFts(database);
  return agent;
}

export async function getActiveAgentId(): Promise<string | null> {
  await ensureAgentSchema();
  const agents = await listAgents();
  return getActiveAgentIdFromStore(agents.map((agent) => agent.id));
}

export async function setActiveAgentId(agentId: string) {
  await setActiveAgentIdInStore(agentId);
  await syncCurrentAgentMemory({ agentId });
}

export async function getActiveTopicId(): Promise<string | null> {
  await ensureAgentSchema();
  return getActiveTopicIdFromStore();
}

export async function setActiveTopicId(topicId: string) {
  await setActiveTopicIdInStore(topicId);
}

export async function listTopics(agentId: string): Promise<TopicSummary[]> {
  const database = await ensureAgentSchema();
  return listTopicsInDatabase(database, agentId);
}

export async function createTopic(options: {
  agentId: string;
  parentTopicId?: string;
  title?: string;
  sessionMode?: TopicSessionMode;
  displayName?: string;
  systemPromptOverride?: string;
  providerIdOverride?: string;
  modelOverride?: string;
  modelFeatures?: TopicModelFeatures;
  enableMemory?: boolean;
  enableSkills?: boolean;
  enableTools?: boolean;
  enableAgentSharedShortTerm?: boolean;
}): Promise<TopicSummary> {
  const database = await ensureAgentSchema();
  const config = await getAgentConfig();
  const timestamp = nowIso();
  const topicId = createId('topic');
  const title = options.title?.trim() || DEFAULT_TOPIC_TITLE;
  const titleSource = options.title?.trim() ? 'manual' : 'auto';
  const sessionMode = options.sessionMode ?? 'agent';
  const enableMemory = options.enableMemory ?? (sessionMode === 'quick' ? false : true);
  const enableSkills = options.enableSkills ?? (sessionMode === 'quick' ? false : true);
  const enableTools = options.enableTools ?? (sessionMode === 'quick' ? false : true);
  const enableAgentSharedShortTerm =
    options.enableAgentSharedShortTerm ?? (sessionMode === 'quick' ? false : config.memory.enableAgentSharedShortTerm);

  database.run(
    `
      INSERT INTO topics (
        id,
        agent_id,
        parent_topic_id,
        session_mode,
        display_name,
        system_prompt_override,
        provider_id_override,
        model_override,
        model_features_json,
        enable_memory,
        enable_skills,
        enable_tools,
        enable_agent_shared_short_term,
        session_summary,
        session_summary_updated_at,
        session_summary_message_count,
        title,
        title_source,
        created_at,
        updated_at,
        last_message_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      topicId,
      options.agentId,
      options.parentTopicId?.trim() || null,
      sessionMode,
      options.displayName?.trim() || null,
      options.systemPromptOverride?.trim() || null,
      options.providerIdOverride?.trim() || null,
      options.modelOverride?.trim() || null,
      JSON.stringify(normalizeTopicModelFeatures(options.modelFeatures)),
      enableMemory ? 1 : 0,
      enableSkills ? 1 : 0,
      enableTools ? 1 : 0,
      enableAgentSharedShortTerm ? 1 : 0,
      null,
      null,
      0,
      title,
      titleSource,
      timestamp,
      timestamp,
      timestamp,
    ],
  );
  await persistAndMaybeRebuildFts(database);

  const topic = mapRows<{
    id: string;
    agent_id: string;
    parent_topic_id: string | null;
    session_mode: TopicSessionMode | null;
    display_name: string | null;
    system_prompt_override: string | null;
    provider_id_override: string | null;
    model_override: string | null;
    model_features_json: string | null;
    enable_memory: number | null;
    enable_skills: number | null;
    enable_tools: number | null;
    enable_agent_shared_short_term: number | null;
    session_summary: string | null;
    session_summary_updated_at: string | null;
    session_summary_message_count: number | null;
    title: string;
    title_source: 'auto' | 'manual';
    preview: string | null;
    created_at: string;
    updated_at: string;
    last_message_at: string;
    message_count: number;
  }>(
    database.exec(
      `
        SELECT
          id,
          agent_id,
          parent_topic_id,
          session_mode,
          display_name,
          system_prompt_override,
          provider_id_override,
          model_override,
          model_features_json,
          enable_memory,
          enable_skills,
          enable_tools,
          enable_agent_shared_short_term,
          session_summary,
          session_summary_updated_at,
          session_summary_message_count,
          title,
          title_source,
          '' AS preview,
          created_at,
          updated_at,
          last_message_at,
          0 AS message_count
        FROM topics
        WHERE id = ?
        LIMIT 1
      `,
      [topicId],
    ),
  )[0];

  if (!topic) {
    throw new Error('Failed to create topic.');
  }

  return toTopicSummary(topic);
}

export async function createQuickTopic(options: {
  agentId: string;
  title?: string;
  displayName?: string;
  systemPromptOverride?: string;
  providerIdOverride?: string;
  modelOverride?: string;
  modelFeatures?: TopicModelFeatures;
}) {
  const config = await getAgentConfig();
  return createTopic({
    agentId: options.agentId,
    title: options.title,
    sessionMode: 'quick',
    displayName: options.displayName,
    systemPromptOverride: options.systemPromptOverride,
    providerIdOverride: options.providerIdOverride ?? config.activeProviderId,
    modelOverride: options.modelOverride ?? config.activeModel,
    modelFeatures: options.modelFeatures,
    enableMemory: false,
    enableSkills: false,
    enableTools: false,
    enableAgentSharedShortTerm: false,
  });
}

export async function createBranchTopicFromTopic(options: {
  sourceTopicId: string;
  title?: string;
  branchGoal?: string;
  includeRecentMessages?: number;
}) {
  const sourceWorkspace = await getTopicWorkspace(options.sourceTopicId);
  if (!sourceWorkspace) {
    throw new Error('Source topic not found.');
  }

  const branchTopic = await createTopic({
    agentId: sourceWorkspace.agent.id,
    parentTopicId: sourceWorkspace.topic.id,
    title: options.title?.trim() || `${sourceWorkspace.topic.title} · Branch`,
    sessionMode: sourceWorkspace.runtime.sessionMode,
    displayName: sourceWorkspace.runtime.displayName,
    systemPromptOverride: sourceWorkspace.runtime.systemPrompt,
    providerIdOverride: sourceWorkspace.runtime.providerId,
    modelOverride: sourceWorkspace.runtime.model,
    modelFeatures: sourceWorkspace.runtime.modelFeatures,
    enableMemory: sourceWorkspace.runtime.enableMemory,
    enableSkills: sourceWorkspace.runtime.enableSkills,
    enableTools: sourceWorkspace.runtime.enableTools,
    enableAgentSharedShortTerm: sourceWorkspace.runtime.enableAgentSharedShortTerm,
  });

  await addTopicMessages([
    {
      topicId: branchTopic.id,
      agentId: sourceWorkspace.agent.id,
      role: 'system',
      authorName: 'Branch Bootstrap',
      content: buildBranchBootstrapContent(
        sourceWorkspace,
        options.branchGoal,
        options.includeRecentMessages ?? 6,
      ),
    },
  ]);

  const hydratedBranch = await getTopicWorkspace(branchTopic.id);
  return hydratedBranch?.topic ?? branchTopic;
}

export async function compileTaskGraphFromTopic(options: {
  sourceTopicId: string;
  title?: string;
  goal: string;
}) {
  const sourceWorkspace = await getTopicWorkspace(options.sourceTopicId);
  if (!sourceWorkspace) {
    throw new Error('Source topic not found.');
  }

  const goal = options.goal.trim();
  if (!goal) {
    throw new Error('Workflow goal is required.');
  }

  const config = await getAgentConfig();
  const compiledGraph = await compileTaskGraphFromGoal({
    config,
    providerId: sourceWorkspace.runtime.providerId,
    model: sourceWorkspace.runtime.model,
    goal,
    title: options.title?.trim() || undefined,
    topicTitle: sourceWorkspace.topic.title,
  });

  const graphId = createId('task_graph');
  const timestamp = nowIso();
  const database = await ensureAgentSchema();

  await runDatabaseTransaction(database, () => {
    database.run(
      `
        INSERT INTO topic_task_graphs (
          id,
          topic_id,
          agent_id,
          title,
          goal,
          summary,
          compiler_provider_id,
          compiler_model,
          compiler_strategy,
          status,
          graph_json,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        graphId,
        sourceWorkspace.topic.id,
        sourceWorkspace.agent.id,
        compiledGraph.title,
        compiledGraph.goal,
        compiledGraph.summary,
        sourceWorkspace.runtime.providerId ?? null,
        sourceWorkspace.runtime.model ?? null,
        compiledGraph.compilerStrategy,
        'draft',
        JSON.stringify(compiledGraph),
        timestamp,
        timestamp,
      ],
    );

    compiledGraph.nodes.forEach((node, index) => {
      database.run(
        `
          INSERT INTO topic_task_nodes (
            id,
            graph_id,
            topic_id,
            agent_id,
            node_key,
            node_type,
            title,
            objective,
            acceptance_criteria,
            depends_on_json,
            branch_topic_id,
            status,
            sort_order,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          createId('task_node'),
          graphId,
          sourceWorkspace.topic.id,
          sourceWorkspace.agent.id,
          node.key,
          node.type,
          node.title,
          node.objective,
          node.acceptanceCriteria,
          JSON.stringify(node.dependsOn),
          null,
          node.type === 'worker' ? 'pending' : 'ready',
          index,
          timestamp,
          timestamp,
        ],
      );
    });

    compiledGraph.edges.forEach((edge) => {
      database.run(
        `
          INSERT INTO topic_task_edges (
            id,
            graph_id,
            from_node_key,
            to_node_key,
            edge_type,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?)
        `,
        [createId('task_edge'), graphId, edge.from, edge.to, edge.type, timestamp],
      );
    });
  });

  await persistAndMaybeRebuildFts(database);

  const workerNodes = compiledGraph.nodes.filter((node) => node.type === 'worker');
  const branchTopics: Array<{ node: CompiledTaskGraphNode; topic: TopicSummary }> = [];

  try {
    for (const node of workerNodes) {
      const branchTopic = await createBranchTopicFromTopic({
        sourceTopicId: sourceWorkspace.topic.id,
        title: `${compiledGraph.title} · ${node.title}`,
        branchGoal: `${node.objective}\n\nAcceptance criteria: ${node.acceptanceCriteria}`,
      });
      branchTopics.push({ node, topic: branchTopic });
    }

    const updateDatabase = await ensureAgentSchema();
    await runDatabaseTransaction(updateDatabase, () => {
      branchTopics.forEach(({ node, topic }) => {
        updateDatabase.run(
          `
            UPDATE topic_task_nodes
            SET
              branch_topic_id = ?,
              status = 'ready',
              updated_at = ?
            WHERE graph_id = ? AND node_key = ?
          `,
          [topic.id, nowIso(), graphId, node.key],
        );
      });

      updateDatabase.run(
        `
          UPDATE topic_task_graphs
          SET
            status = 'ready',
            updated_at = ?
          WHERE id = ?
        `,
        [nowIso(), graphId],
      );
    });

    await persistAndMaybeRebuildFts(updateDatabase);
  } catch (error) {
    const failedDatabase = await ensureAgentSchema();
    failedDatabase.run(
      `
        UPDATE topic_task_graphs
        SET
          status = 'failed',
          updated_at = ?
        WHERE id = ?
      `,
      [nowIso(), graphId],
    );
    await persistAndMaybeRebuildFts(failedDatabase);
    throw error;
  }

  await addTopicMessages([
    {
      topicId: sourceWorkspace.topic.id,
      agentId: sourceWorkspace.agent.id,
      role: 'system',
      authorName: 'Workflow Compiler',
      content: buildTaskGraphCompiledMessage(compiledGraph, branchTopics),
    },
  ]);

  return {
    graph: {
      id: graphId,
      topicId: sourceWorkspace.topic.id,
      agentId: sourceWorkspace.agent.id,
      title: compiledGraph.title,
      goal: compiledGraph.goal,
      summary: compiledGraph.summary,
      compilerProviderId: sourceWorkspace.runtime.providerId,
      compilerModel: sourceWorkspace.runtime.model,
      compilerStrategy: compiledGraph.compilerStrategy,
      status: 'ready' as const,
      createdAt: timestamp,
      updatedAt: nowIso(),
      nodes: compiledGraph.nodes.map((node) => {
        const branchTopic = branchTopics.find((entry) => entry.node.key === node.key)?.topic;
        return {
          id: `${graphId}_${node.key}`,
          graphId,
          topicId: sourceWorkspace.topic.id,
          agentId: sourceWorkspace.agent.id,
          ...node,
          branchTopicId: branchTopic?.id,
          status: node.type === 'worker' ? 'ready' : 'ready',
          createdAt: timestamp,
          updatedAt: timestamp,
        };
      }),
      edges: compiledGraph.edges,
    },
    branchTopics: branchTopics.map((entry) => entry.topic),
  };
}

export async function handoffBranchTopicToParent(options: {
  branchTopicId: string;
  note?: string;
  includeRecentMessages?: number;
}) {
  const branchWorkspace = await getTopicWorkspace(options.branchTopicId);
  if (!branchWorkspace) {
    throw new Error('Branch topic not found.');
  }
  if (!branchWorkspace.topic.parentTopicId) {
    throw new Error('The selected topic is not a branch topic.');
  }

  const parentWorkspace = await getTopicWorkspace(branchWorkspace.topic.parentTopicId);
  if (!parentWorkspace) {
    throw new Error('Parent topic not found.');
  }

  const handoffContent = buildBranchHandoffContent(
    branchWorkspace,
    options.note,
    options.includeRecentMessages ?? 6,
  );
  const timestamp = nowIso();

  await addTopicMessages([
    {
      topicId: parentWorkspace.topic.id,
      agentId: parentWorkspace.agent.id,
      role: 'assistant',
      authorName: `${branchWorkspace.runtime.displayName} · Branch`,
      content: handoffContent,
      createdAt: timestamp,
    },
    {
      topicId: branchWorkspace.topic.id,
      agentId: branchWorkspace.agent.id,
      role: 'system',
      authorName: 'Branch Handoff',
      content: `Sent a branch handoff to parent topic "${parentWorkspace.topic.title}".${
        options.note?.trim() ? ` Note: ${options.note.trim()}` : ''
      }`,
      createdAt: timestamp,
    },
  ]);
  const completedTaskNodes = await markBranchTaskNodesCompleted(branchWorkspace.topic.id, timestamp);
  const reviewReadyWorkflows = await markWorkflowGraphsReviewReady(completedTaskNodes, timestamp);
  const reviewReadyWorkflowResults = await createReviewerBranchesForReviewReadyWorkflows(
    reviewReadyWorkflows,
    timestamp,
  );

  if (reviewReadyWorkflowResults.length > 0) {
    await addTopicMessages(
      reviewReadyWorkflowResults.map((workflow) => ({
        topicId: workflow.topicId,
        agentId: workflow.agentId,
        role: 'system',
        authorName: 'Workflow Reviewer',
        content: workflow.content,
        createdAt: timestamp,
      })),
    );
  }

  const [updatedParent, updatedBranch] = await Promise.all([
    getTopicWorkspace(parentWorkspace.topic.id),
    getTopicWorkspace(branchWorkspace.topic.id),
  ]);

  if (!updatedParent || !updatedBranch) {
    throw new Error('Failed to reload topics after branch handoff.');
  }

  return {
    parentTopic: updatedParent.topic,
    branchTopic: updatedBranch.topic,
    completedTaskNodes,
    reviewReadyWorkflows: reviewReadyWorkflowResults,
  };
}

export async function retryWorkflowBranchTask(options: { branchTopicId: string; reason?: string }) {
  const previousWorkspace = await getTopicWorkspace(options.branchTopicId);
  if (!previousWorkspace) {
    throw new Error('Branch topic not found.');
  }
  if (!previousWorkspace.topic.parentTopicId) {
    throw new Error('Only workflow branch topics can be retried.');
  }

  const database = await ensureAgentSchema();
  const taskRow = mapRows<
    TopicTaskGraphNodeRow & {
      graph_title: string;
    }
  >(
    database.exec(
      `
        SELECT
          n.id,
          n.graph_id,
          n.topic_id,
          n.agent_id,
          n.node_key,
          n.node_type,
          n.title,
          n.objective,
          n.acceptance_criteria,
          n.depends_on_json,
          n.branch_topic_id,
          n.status,
          n.created_at,
          n.updated_at,
          g.title AS graph_title
        FROM topic_task_nodes n
        JOIN topic_task_graphs g ON g.id = n.graph_id
        WHERE n.branch_topic_id = ?
        LIMIT 1
      `,
      [options.branchTopicId],
    ),
  )[0];

  if (!taskRow) {
    throw new Error('No workflow task node is linked to this branch.');
  }
  if (taskRow.node_type !== 'worker') {
    throw new Error('Only worker branch tasks can be retried.');
  }

  const retryBranchTopic = await createBranchTopicFromTopic({
    sourceTopicId: taskRow.topic_id,
    title: `${taskRow.graph_title} · ${taskRow.title} · Retry`,
    branchGoal: [
      `Retry worker task: ${taskRow.title}`,
      `Objective: ${taskRow.objective}`,
      `Acceptance criteria: ${taskRow.acceptance_criteria}`,
      options.reason?.trim() ? `Retry reason: ${options.reason.trim()}` : '',
      `Previous branch: ${previousWorkspace.topic.title}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
    includeRecentMessages: 8,
  });

  const timestamp = nowIso();
  const updateDatabase = await ensureAgentSchema();
  await runDatabaseTransaction(updateDatabase, () => {
    updateDatabase.run(
      `
        UPDATE topic_task_nodes
        SET
          branch_topic_id = ?,
          status = 'ready',
          updated_at = ?
        WHERE id = ?
      `,
      [retryBranchTopic.id, timestamp, taskRow.id],
    );
    updateDatabase.run(
      `
        UPDATE topic_task_nodes
        SET
          branch_topic_id = NULL,
          updated_at = ?
        WHERE graph_id = ? AND node_type = 'reviewer'
      `,
      [timestamp, taskRow.graph_id],
    );
    updateDatabase.run(
      `
        UPDATE topic_task_graphs
        SET
          status = 'ready',
          reviewer_branch_topic_id = NULL,
          updated_at = ?
        WHERE id = ?
      `,
      [timestamp, taskRow.graph_id],
    );
  });
  await saveDB();

  await addTopicMessages([
    {
      topicId: previousWorkspace.topic.id,
      agentId: previousWorkspace.agent.id,
      role: 'system',
      authorName: 'Workflow Retry',
      content: `Retried workflow task "${taskRow.title}" in branch "${retryBranchTopic.title}".${
        options.reason?.trim() ? ` Reason: ${options.reason.trim()}` : ''
      }`,
      createdAt: timestamp,
    },
    {
      topicId: taskRow.topic_id,
      agentId: taskRow.agent_id,
      role: 'system',
      authorName: 'Workflow Retry',
      content: `Workflow task retried: ${taskRow.title}\nNew branch: ${retryBranchTopic.title}\nPrevious branch: ${previousWorkspace.topic.title}`,
      createdAt: timestamp,
    },
  ]);

  return {
    previousBranchTopic: previousWorkspace.topic,
    retryBranchTopic,
    retriedTaskNode: toTopicTaskGraphNode({
      ...taskRow,
      branch_topic_id: retryBranchTopic.id,
      status: 'ready',
      updated_at: timestamp,
    }),
  };
}

export async function updateTopicTitle(topicId: string, title: string): Promise<void> {
  const database = await ensureAgentSchema();
  const normalizedTitle = title.trim() || DEFAULT_TOPIC_TITLE;
  database.run(
    `
      UPDATE topics
      SET
        title = ?,
        title_source = 'manual',
        updated_at = ?
      WHERE id = ?
    `,
    [normalizedTitle, nowIso(), topicId],
  );
  await persistAndMaybeRebuildFts(database);
}

export async function updateTopicSessionSettings(
  topicId: string,
  updates: {
    displayName?: string;
    systemPromptOverride?: string;
    providerIdOverride?: string;
    modelOverride?: string;
    enableMemory?: boolean;
    enableSkills?: boolean;
    enableTools?: boolean;
    enableAgentSharedShortTerm?: boolean;
  },
): Promise<TopicSummary> {
  const database = await ensureAgentSchema();
  const current = fetchTopicSummaryById(database, topicId);
  if (!current) {
    throw new Error('Topic not found.');
  }

  database.run(
    `
      UPDATE topics
      SET
        display_name = ?,
        system_prompt_override = ?,
        provider_id_override = ?,
        model_override = ?,
        enable_memory = ?,
        enable_skills = ?,
        enable_tools = ?,
        enable_agent_shared_short_term = ?,
        updated_at = ?
      WHERE id = ?
    `,
    [
      normalizeNullableOverride(updates.displayName, current.displayName),
      normalizeNullableOverride(updates.systemPromptOverride, current.systemPromptOverride),
      normalizeNullableOverride(updates.providerIdOverride, current.providerIdOverride),
      normalizeNullableOverride(updates.modelOverride, current.modelOverride),
      updates.enableMemory === undefined ? (current.enableMemory ? 1 : 0) : updates.enableMemory ? 1 : 0,
      updates.enableSkills === undefined ? (current.enableSkills ? 1 : 0) : updates.enableSkills ? 1 : 0,
      updates.enableTools === undefined ? (current.enableTools ? 1 : 0) : updates.enableTools ? 1 : 0,
      updates.enableAgentSharedShortTerm === undefined
        ? current.enableAgentSharedShortTerm
          ? 1
          : 0
        : updates.enableAgentSharedShortTerm
          ? 1
          : 0,
      nowIso(),
      topicId,
    ],
  );
  await persistAndMaybeRebuildFts(database);

  const updated = fetchTopicSummaryById(database, topicId);
  if (!updated) {
    throw new Error('Failed to reload topic settings.');
  }

  return updated;
}

export async function updateTopicModelFeatures(
  topicId: string,
  updates: Partial<TopicModelFeatures>,
): Promise<TopicSummary> {
  const database = await ensureAgentSchema();
  const current = fetchTopicSummaryById(database, topicId);
  if (!current) {
    throw new Error('Topic not found.');
  }

  database.run(
    `
      UPDATE topics
      SET
        model_features_json = ?,
        updated_at = ?
      WHERE id = ?
    `,
    [JSON.stringify(normalizeTopicModelFeatures({ ...current.modelFeatures, ...updates })), nowIso(), topicId],
  );
  await persistAndMaybeRebuildFts(database);

  const updated = fetchTopicSummaryById(database, topicId);
  if (!updated) {
    throw new Error('Failed to reload topic model features.');
  }

  return updated;
}

export async function getTopicWorkspace(topicId: string): Promise<TopicWorkspace | null> {
  const database = await ensureAgentSchema();
  const topicRow = mapRows<{
    id: string;
    agent_id: string;
    parent_topic_id: string | null;
    session_mode: TopicSessionMode | null;
    display_name: string | null;
    system_prompt_override: string | null;
    provider_id_override: string | null;
    model_override: string | null;
    model_features_json: string | null;
    enable_memory: number | null;
    enable_skills: number | null;
    enable_tools: number | null;
    enable_agent_shared_short_term: number | null;
    session_summary: string | null;
    session_summary_updated_at: string | null;
    session_summary_message_count: number | null;
    title: string;
    title_source: 'auto' | 'manual';
    preview: string | null;
    created_at: string;
    updated_at: string;
    last_message_at: string;
    message_count: number;
  }>(
    database.exec(
      `
        SELECT
          t.id,
          t.agent_id,
          t.parent_topic_id,
          t.session_mode,
          t.display_name,
          t.system_prompt_override,
          t.provider_id_override,
          t.model_override,
          t.model_features_json,
          t.enable_memory,
          t.enable_skills,
          t.enable_tools,
          t.enable_agent_shared_short_term,
          t.session_summary,
          t.session_summary_updated_at,
          t.session_summary_message_count,
          t.title,
          t.title_source,
          (
            SELECT content
            FROM topic_messages
            WHERE topic_id = t.id
            ORDER BY created_at DESC
            LIMIT 1
          ) AS preview,
          t.created_at,
          t.updated_at,
          t.last_message_at,
          (
            SELECT COUNT(*)
            FROM topic_messages
            WHERE topic_id = t.id
          ) AS message_count
        FROM topics t
        WHERE t.id = ?
        LIMIT 1
      `,
      [topicId],
    ),
  )[0];

  if (!topicRow) {
    return null;
  }

  await syncCurrentAgentMemory({
    database,
    agentId: topicRow.agent_id,
    persist: true,
  });

  const agent = getAgentRow(database, topicRow.agent_id);
  if (!agent) {
    return null;
  }

  const messageRows = mapRows<{
    id: string;
    topic_id: string;
    agent_id: string;
    role: TopicMessage['role'];
    author_name: string;
    content: string;
    attachments_json: string | null;
    tools_json: string | null;
    created_at: string;
  }>(
    database.exec(
      `
        SELECT id, topic_id, agent_id, role, author_name, content, attachments_json, tools_json, created_at
        FROM topic_messages
        WHERE topic_id = ?
        ORDER BY created_at ASC
      `,
      [topicId],
    ),
  );

  const memoryRows = mapRows<{
    id: string;
    agent_id: string;
    title: string;
    content: string;
    memory_scope: MemoryScope;
    source_type: MemorySourceType;
    importance_score: number;
    topic_id: string | null;
    event_date: string | null;
    created_at: string;
    updated_at: string;
  }>(
    database.exec(
      `
        SELECT
          id,
          agent_id,
          title,
          content,
          memory_scope,
          source_type,
          importance_score,
          topic_id,
          event_date,
          created_at,
          updated_at
        FROM agent_memory_documents
        WHERE agent_id = ?
          AND memory_scope = 'global'
        ORDER BY updated_at DESC, created_at DESC
      `,
      [agent.id],
    ),
  );

  const topic = toTopicSummary(topicRow);

  return {
    agent,
    topic,
    runtime: resolveTopicRuntimeProfile(topic, agent),
    messages: messageRows.map(toTopicMessage),
    memoryDocuments: memoryRows.map(toAgentMemoryDocument),
    sessionSummary:
      typeof topicRow.session_summary === 'string' && topicRow.session_summary.trim()
        ? {
            content: topicRow.session_summary,
            updatedAt: topicRow.session_summary_updated_at ?? topic.updatedAt,
            sourceMessageCount: Number(topicRow.session_summary_message_count) || 0,
          }
        : undefined,
  };
}

export async function refreshTopicSessionSummary(
  topicId: string,
  historyWindow: number,
  tokenBudget?: number,
  options?: {
    buildSummary?: (input: TopicSessionSummaryBuilderInput) => Promise<string | null | undefined>;
  },
): Promise<TopicSessionSummary | null> {
  const database = await ensureAgentSchema();
  const messageRows = mapRows<{
    id: string;
    topic_id: string;
    agent_id: string;
    role: TopicMessage['role'];
    author_name: string;
    content: string;
    attachments_json: string | null;
    tools_json: string | null;
    created_at: string;
  }>(
    database.exec(
      `
        SELECT
          id,
          topic_id,
          agent_id,
          role,
          author_name,
          content,
          attachments_json,
          tools_json,
          created_at
        FROM topic_messages
        WHERE topic_id = ?
        ORDER BY created_at ASC
      `,
      [topicId],
    ),
  );

  const messages = messageRows.map(toTopicMessage);
  const deterministicSummary = buildTopicSessionSummary(messages, historyWindow, tokenBudget);
  const modelSummaryContent = options?.buildSummary
    ? await options.buildSummary({
        messages,
        historyWindow,
        tokenBudget,
        deterministicSummary,
      })
    : null;
  const nextSummary = modelSummaryContent?.trim()
    ? {
        content: modelSummaryContent.trim(),
        sourceMessageCount: deterministicSummary?.sourceMessageCount ?? messages.length,
      }
    : deterministicSummary;
  const current = mapRows<{
    session_summary: string | null;
    session_summary_updated_at: string | null;
    session_summary_message_count: number | null;
  }>(
    database.exec(
      `
        SELECT
          session_summary,
          session_summary_updated_at,
          session_summary_message_count
        FROM topics
        WHERE id = ?
        LIMIT 1
      `,
      [topicId],
    ),
  )[0];

  const nextContent = nextSummary?.content ?? null;
  const nextCount = nextSummary?.sourceMessageCount ?? 0;
  const currentContent = current?.session_summary ?? null;
  const currentCount = Number(current?.session_summary_message_count) || 0;

  if (currentContent === nextContent && currentCount === nextCount) {
    return nextSummary
      ? {
          content: nextSummary.content,
          updatedAt: current?.session_summary_updated_at ?? nowIso(),
          sourceMessageCount: nextSummary.sourceMessageCount,
        }
      : null;
  }

  const updatedAt = nowIso();
  database.run(
    `
      UPDATE topics
      SET
        session_summary = ?,
        session_summary_updated_at = ?,
        session_summary_message_count = ?,
        updated_at = ?
      WHERE id = ?
    `,
    [nextContent, nextSummary ? updatedAt : null, nextCount, updatedAt, topicId],
  );
  await saveDB();

  return nextSummary
    ? {
        content: nextSummary.content,
        updatedAt,
        sourceMessageCount: nextSummary.sourceMessageCount,
      }
    : null;
}

function appendMemoryLine(existingContent: string, line: string) {
  const trimmed = existingContent.trim();
  return trimmed ? `${trimmed}\n\n${line}` : line;
}

function dateKeyFromIso(timestamp: string) {
  return timestamp.slice(0, 10);
}

async function markBranchTaskNodesCompleted(branchTopicId: string, completedAt: string) {
  const database = await ensureAgentSchema();
  const rows = mapRows<TopicTaskGraphNodeRow>(
    database.exec(
      `
        SELECT
          id,
          graph_id,
          topic_id,
          agent_id,
          node_key,
          node_type,
          title,
          objective,
          acceptance_criteria,
          depends_on_json,
          branch_topic_id,
          status,
          created_at,
          updated_at
        FROM topic_task_nodes
        WHERE branch_topic_id = ?
        ORDER BY sort_order ASC
      `,
      [branchTopicId],
    ),
  );

  if (rows.length === 0) {
    return [];
  }

  await runDatabaseTransaction(database, () => {
    database.run(
      `
        UPDATE topic_task_nodes
        SET
          status = 'completed',
          updated_at = ?
        WHERE branch_topic_id = ?
      `,
      [completedAt, branchTopicId],
    );
    const graphIds = [...new Set(rows.map((row) => row.graph_id))];
    graphIds.forEach((graphId) => {
      database.run('UPDATE topic_task_graphs SET updated_at = ? WHERE id = ?', [completedAt, graphId]);
    });
  });

  await saveDB();
  return rows.map((row) =>
    toTopicTaskGraphNode({
      ...row,
      status: 'completed',
      updated_at: completedAt,
    }),
  );
}

async function markWorkflowGraphsReviewReady(completedNodes: TopicTaskGraphNode[], completedAt: string) {
  const graphIds = [...new Set(completedNodes.map((node) => node.graphId))];
  if (graphIds.length === 0) {
    return [];
  }

  const database = await ensureAgentSchema();
  const readyRollups: Array<{
    graphId: string;
    topicId: string;
    agentId: string;
    title: string;
    content: string;
    workerNodes: TopicTaskGraphNode[];
  }> = [];

  for (const graphId of graphIds) {
    const graph = mapRows<TopicTaskGraphRow>(
      database.exec(
        `
          SELECT id, topic_id, agent_id, title, goal, status, reviewer_branch_topic_id, updated_at
          FROM topic_task_graphs
          WHERE id = ?
          LIMIT 1
        `,
        [graphId],
      ),
    )[0];
    if (!graph || graph.status !== 'ready' || graph.reviewer_branch_topic_id) {
      continue;
    }

    const workerRows = mapRows<TopicTaskGraphNodeRow>(
      database.exec(
        `
          SELECT
            id,
            graph_id,
            topic_id,
            agent_id,
            node_key,
            node_type,
            title,
            objective,
            acceptance_criteria,
            depends_on_json,
            branch_topic_id,
            status,
            created_at,
            updated_at
          FROM topic_task_nodes
          WHERE graph_id = ? AND node_type = 'worker'
          ORDER BY sort_order ASC
        `,
        [graphId],
      ),
    );
    const workerNodes = workerRows.map(toTopicTaskGraphNode);
    if (workerNodes.length === 0 || workerNodes.some((node) => node.status !== 'completed')) {
      continue;
    }

    database.run(
      `
        UPDATE topic_task_graphs
        SET
          status = 'review_ready',
          updated_at = ?
        WHERE id = ? AND status = 'ready'
      `,
      [completedAt, graphId],
    );

    readyRollups.push({
      graphId,
      topicId: graph.topic_id,
      agentId: graph.agent_id,
      title: graph.title,
      content: buildWorkflowReviewReadyMessage({
        graphTitle: graph.title,
        graphGoal: graph.goal,
        workerNodes,
      }),
      workerNodes,
    });
  }

  if (readyRollups.length > 0) {
    await saveDB();
  }

  return readyRollups;
}

async function createReviewerBranchesForReviewReadyWorkflows(
  workflows: Array<{
    graphId: string;
    topicId: string;
    agentId: string;
    title: string;
    content: string;
    workerNodes: TopicTaskGraphNode[];
  }>,
  timestamp: string,
) {
  const results: Array<
    (typeof workflows)[number] & {
      reviewerBranchTopic?: TopicSummary;
    }
  > = [];

  for (const workflow of workflows) {
    const database = await ensureAgentSchema();
    const graph = mapRows<{ reviewer_branch_topic_id: string | null }>(
      database.exec(
        `
          SELECT reviewer_branch_topic_id
          FROM topic_task_graphs
          WHERE id = ?
          LIMIT 1
        `,
        [workflow.graphId],
      ),
    )[0];
    if (graph?.reviewer_branch_topic_id) {
      results.push(workflow);
      continue;
    }

    const reviewerNode = mapRows<{ id: string; branch_topic_id: string | null }>(
      database.exec(
        `
          SELECT id, branch_topic_id
          FROM topic_task_nodes
          WHERE graph_id = ? AND node_type = 'reviewer'
          LIMIT 1
        `,
        [workflow.graphId],
      ),
    )[0];

    if (!reviewerNode || reviewerNode.branch_topic_id) {
      results.push(workflow);
      continue;
    }

    const reviewerBranchTopic = await createBranchTopicFromTopic({
      sourceTopicId: workflow.topicId,
      title: `${workflow.title} · Reviewer`,
      branchGoal: [
        'Review the completed worker branch handoffs for this workflow.',
        'Produce a merged final answer, call out conflicts or missing evidence, and keep the response concise.',
        workflow.content,
      ].join('\n\n'),
      includeRecentMessages: 10,
    });

    const updateDatabase = await ensureAgentSchema();
    updateDatabase.run(
      `
        UPDATE topic_task_nodes
        SET
          branch_topic_id = ?,
          status = 'ready',
          updated_at = ?
        WHERE id = ? AND branch_topic_id IS NULL
      `,
      [reviewerBranchTopic.id, timestamp, reviewerNode.id],
    );
    updateDatabase.run(
      `
        UPDATE topic_task_graphs
        SET
          reviewer_branch_topic_id = ?,
          updated_at = ?
        WHERE id = ? AND reviewer_branch_topic_id IS NULL
      `,
      [reviewerBranchTopic.id, timestamp, workflow.graphId],
    );
    await saveDB();

    results.push({
      ...workflow,
      reviewerBranchTopic,
    });
  }

  return results;
}

function upsertDailyMemoryLog(
  database: Database,
  input: {
    agentId: string;
    topicId: string;
    topicTitle: string;
    role: TopicMessage['role'];
    authorName: string;
    content: string;
    createdAt: string;
    attachments?: TopicMessageAttachment[];
    tools?: StoredToolRun[];
  },
) {
  const eventDate = dateKeyFromIso(input.createdAt);
  const line = buildConversationMemoryEntry({
    topicTitle: input.topicTitle,
    authorName: input.authorName,
    role: input.role,
    createdAt: input.createdAt,
    content: input.content,
    attachments: input.attachments,
    tools: input.tools,
  });
  const importanceScore = scoreMemoryImportance(input.content, 'conversation_log');
  const existing = mapRows<{
    id: string;
    content: string;
    importance_score: number;
  }>(
    database.exec(
      `
        SELECT id, content, importance_score
        FROM agent_memory_documents
        WHERE agent_id = ?
          AND memory_scope = 'daily'
          AND event_date = ?
        LIMIT 1
      `,
      [input.agentId, eventDate],
    ),
  )[0];

  if (existing) {
    database.run(
      `
        UPDATE agent_memory_documents
        SET
          content = ?,
          importance_score = ?,
          updated_at = ?
        WHERE id = ?
      `,
      [
        appendMemoryLine(existing.content, line),
        Math.max(Number(existing.importance_score) || 0, importanceScore),
        input.createdAt,
        existing.id,
      ],
    );
    return;
  }

  database.run(
    `
      INSERT INTO agent_memory_documents (
        id,
        agent_id,
        title,
        content,
        memory_scope,
        source_type,
        importance_score,
        topic_id,
        event_date,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      createId('memory'),
      input.agentId,
      `${eventDate} Activity Log`,
      line,
      'daily',
      'conversation_log',
      importanceScore,
      input.topicId,
      eventDate,
      input.createdAt,
      input.createdAt,
    ],
  );
}

function upsertPromotedMemory(
  database: Database,
  input: {
    agentId: string;
    topicId: string;
    content: string;
    createdAt: string;
  },
) {
  const normalizedTitle = buildMemoryPromotionTitle(input.content);
  const id = buildPromotionFingerprint(`${input.agentId}:${input.content}`);
  const importanceScore = scoreMemoryImportance(input.content, 'promotion');
  const existing = Number(
    getScalar(database, 'SELECT COUNT(*) FROM agent_memory_documents WHERE id = ?', [id]) ?? 0,
  );

  if (existing > 0) {
    database.run(
      `
        UPDATE agent_memory_documents
        SET
          title = ?,
          content = ?,
          importance_score = ?,
          topic_id = ?,
          updated_at = ?
        WHERE id = ?
      `,
      [normalizedTitle, input.content.trim(), importanceScore, input.topicId, input.createdAt, id],
    );
    return;
  }

  database.run(
    `
      INSERT INTO agent_memory_documents (
        id,
        agent_id,
        title,
        content,
        memory_scope,
        source_type,
        importance_score,
        topic_id,
        event_date,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      id,
      input.agentId,
      normalizedTitle,
      input.content.trim(),
      'global',
      'promotion',
      importanceScore,
      input.topicId,
      null,
      input.createdAt,
      input.createdAt,
    ],
  );
}

function recordMemoryFromMessages(database: Database, messages: TopicMessageInput[]) {
  const topicIds = [...new Set(messages.map((message) => message.topicId))];
  const topicRows = mapRows<{ id: string; title: string }>(
    database.exec(
      `
        SELECT id, title
        FROM topics
        WHERE id IN (${topicIds.map(() => '?').join(', ')})
      `,
      topicIds,
    ),
  );
  const topicTitles = new Map(topicRows.map((topic) => [topic.id, topic.title]));

  messages.forEach((message) => {
    if ((message.role !== 'user' && message.role !== 'assistant') || !message.content.trim()) {
      return;
    }

    const createdAt = message.createdAt ?? nowIso();
    const topicTitle = topicTitles.get(message.topicId) ?? DEFAULT_TOPIC_TITLE;
    upsertDailyMemoryLog(database, {
      agentId: message.agentId,
      topicId: message.topicId,
      topicTitle,
      role: message.role,
      authorName: message.authorName,
      content: message.content,
      createdAt,
      attachments: message.attachments,
      tools: message.tools,
    });

    if (shouldPromoteMemory(message.content, message.role)) {
      upsertPromotedMemory(database, {
        agentId: message.agentId,
        topicId: message.topicId,
        content: message.content,
        createdAt,
      });
    }
  });
}

export async function addTopicMessages(messages: TopicMessageInput[]): Promise<void> {
  if (messages.length === 0) {
    return;
  }

  const database = await ensureAgentSchema();
  await runDatabaseTransaction(database, () => {
    messages.forEach((message) => {
      const createdAt = message.createdAt ?? nowIso();
      database.run(
        `
          INSERT INTO topic_messages (
            id,
            topic_id,
            agent_id,
            role,
            author_name,
            content,
            attachments_json,
            tools_json,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          message.id ?? createId('message'),
          message.topicId,
          message.agentId,
          message.role,
          message.authorName,
          message.content,
          message.attachments ? JSON.stringify(message.attachments) : null,
          message.tools ? JSON.stringify(message.tools) : null,
          createdAt,
        ],
      );

      database.run(
        `
          UPDATE topics
          SET
            updated_at = ?,
            last_message_at = ?
          WHERE id = ?
        `,
        [createdAt, createdAt, message.topicId],
      );
    });
    recordMemoryFromMessages(database, messages);
  });

  await persistAndMaybeRebuildFts(database);
}

export async function deleteTopicMessage(messageId: string): Promise<void> {
  const database = await ensureAgentSchema();
  const messageRow = mapRows<{
    id: string;
    topic_id: string;
    created_at: string;
  }>(
    database.exec(
      `
        SELECT id, topic_id, created_at
        FROM topic_messages
        WHERE id = ?
      `,
      [messageId],
    ),
  )[0];

  if (!messageRow) {
    return;
  }

  await runDatabaseTransaction(database, () => {
    database.run('DELETE FROM topic_messages WHERE id = ?', [messageId]);

    const topicMeta = mapRows<{
      last_message_at: string | null;
      preview: string | null;
    }>(
      database.exec(
        `
          SELECT
            MAX(created_at) AS last_message_at,
            (
              SELECT TRIM(content)
              FROM topic_messages
              WHERE topic_id = ?
              ORDER BY created_at DESC
              LIMIT 1
            ) AS preview
          FROM topic_messages
          WHERE topic_id = ?
        `,
        [messageRow.topic_id, messageRow.topic_id],
      ),
    )[0];

    const nextLastMessageAt = topicMeta?.last_message_at ?? nowIso();
    const nextPreview = formatTopicPreview(topicMeta?.preview ?? '') || DEFAULT_TOPIC_PREVIEW;
    database.run(
      `
        UPDATE topics
        SET
          updated_at = ?,
          last_message_at = ?,
          preview = ?
        WHERE id = ?
      `,
      [nowIso(), nextLastMessageAt, nextPreview, messageRow.topic_id],
    );
  });

  await persistAndMaybeRebuildFts(database);
}

export async function maybeAutoTitleTopic(topicId: string, input: string): Promise<void> {
  const database = await ensureAgentSchema();
  const topic = mapRows<{ title_source: string; title: string }>(
    database.exec('SELECT title_source, title FROM topics WHERE id = ? LIMIT 1', [topicId]),
  )[0];
  if (!topic || topic.title_source !== 'auto' || topic.title !== DEFAULT_TOPIC_TITLE) {
    return;
  }

  const normalizedTitle = input
    .replace(/[#*_`>~-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48)
    .trim();

  if (!normalizedTitle) {
    return;
  }

  database.run(
    `
      UPDATE topics
      SET
        title = ?,
        updated_at = ?
      WHERE id = ?
    `,
    [normalizedTitle, nowIso(), topicId],
  );
  await persistAndMaybeRebuildFts(database);
}

export async function listAgentMemoryDocuments(
  agentId: string,
  options?: { scopes?: MemoryScope[]; now?: string },
): Promise<AgentMemoryDocument[]> {
  const database = await ensureAgentSchema();
  await syncCurrentAgentMemory({
    database,
    agentId,
    now: options?.now,
    persist: true,
  });
  const scopes = options?.scopes?.length ? options.scopes : (['global'] as MemoryScope[]);
  const placeholders = scopes.map(() => '?').join(', ');
  const rows = mapRows<{
    id: string;
    agent_id: string;
    title: string;
    content: string;
    memory_scope: MemoryScope;
    source_type: MemorySourceType;
    importance_score: number;
    topic_id: string | null;
    event_date: string | null;
    created_at: string;
    updated_at: string;
  }>(
    database.exec(
      `
        SELECT
          id,
          agent_id,
          title,
          content,
          memory_scope,
          source_type,
          importance_score,
          topic_id,
          event_date,
          created_at,
          updated_at
        FROM agent_memory_documents
        WHERE agent_id = ?
          AND memory_scope IN (${placeholders})
        ORDER BY updated_at DESC, created_at DESC
      `,
      [agentId, ...scopes],
    ),
  );

  return rows.map(toAgentMemoryDocument);
}

export async function saveAgentMemoryDocument(draft: {
  id?: string;
  agentId: string;
  title: string;
  content: string;
  memoryScope?: MemoryScope;
  sourceType?: MemorySourceType;
  importanceScore?: number;
  topicId?: string;
  eventDate?: string;
}): Promise<AgentMemoryDocument> {
  const database = await ensureAgentSchema();
  const timestamp = nowIso();
  const id = draft.id || createId('memory');
  const exists = Number(getScalar(database, 'SELECT COUNT(*) FROM agent_memory_documents WHERE id = ?', [id]) ?? 0);
  const memoryScope = draft.memoryScope ?? 'global';
  const sourceType = draft.sourceType ?? 'manual';
  const importanceScore = draft.importanceScore ?? scoreMemoryImportance(draft.content, sourceType);

  if (exists > 0) {
    database.run(
      `
        UPDATE agent_memory_documents
        SET
          title = ?,
          content = ?,
          memory_scope = ?,
          source_type = ?,
          importance_score = ?,
          topic_id = ?,
          event_date = ?,
          updated_at = ?
        WHERE id = ?
      `,
      [
        draft.title.trim() || 'Untitled Memory',
        draft.content,
        memoryScope,
        sourceType,
        importanceScore,
        draft.topicId ?? null,
        draft.eventDate ?? null,
        timestamp,
        id,
      ],
    );
  } else {
    database.run(
      `
        INSERT INTO agent_memory_documents (
          id,
          agent_id,
          title,
          content,
          memory_scope,
          source_type,
          importance_score,
          topic_id,
          event_date,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        id,
        draft.agentId,
        draft.title.trim() || 'Untitled Memory',
        draft.content,
        memoryScope,
        sourceType,
        importanceScore,
        draft.topicId ?? null,
        draft.eventDate ?? null,
        timestamp,
        timestamp,
      ],
    );
  }

  await persistAndMaybeRebuildFts(database);
  const row = mapRows<{
    id: string;
    agent_id: string;
    title: string;
    content: string;
    memory_scope: MemoryScope;
    source_type: MemorySourceType;
    importance_score: number;
    topic_id: string | null;
    event_date: string | null;
    created_at: string;
    updated_at: string;
  }>(
    database.exec(
      `
        SELECT
          id,
          agent_id,
          title,
          content,
          memory_scope,
          source_type,
          importance_score,
          topic_id,
          event_date,
          created_at,
          updated_at
        FROM agent_memory_documents
        WHERE id = ?
        LIMIT 1
      `,
      [id],
    ),
  )[0];

  if (!row) {
    throw new Error('Failed to save agent memory document.');
  }

  return toAgentMemoryDocument(row);
}

export async function searchMemories(
  agentId: string,
  options?: {
    now?: string;
    query?: string;
    embeddingConfig?: EmbeddingProviderConfig | null;
    topicId?: string;
    includeSessionMemory?: boolean;
    includeAgentSharedShortTerm?: boolean;
  },
): Promise<AgentMemorySearchResult[]> {
  const now = options?.now ?? new Date().toISOString();
  const database = await ensureAgentSchema();
  const rawDocuments = await listAgentMemoryDocuments(agentId, {
    scopes: ['global', 'daily', 'session'],
    now,
  });
  const documents = selectEffectiveMemoryDocuments(
    rawDocuments.filter((document) => {
      if (document.memoryScope === 'global') {
        return true;
      }
      if (document.memoryScope === 'daily') {
        return options?.includeAgentSharedShortTerm ?? true;
      }
      if (document.memoryScope === 'session') {
        if (!(options?.includeSessionMemory ?? true)) {
          return false;
        }
        return options?.topicId ? document.topicId === options.topicId : true;
      }
      return false;
    }),
    { now },
  );

  const normalizedQuery = options?.query?.trim();
  if (!normalizedQuery) {
    return toMemorySearchResults(documents, 'preferred', now);
  }

  const route = routeMemoryQuery(normalizedQuery, { now });
  const preferredDocuments = selectMemoryDocumentsByLayers(documents, route.preferredLayers, now);
  const preferredResults = toMemorySearchResults(preferredDocuments, 'preferred', now, normalizedQuery);
  const preferredGlobalDocuments = preferredDocuments.filter((document) => document.memoryScope === 'global');

  if (route.mode === 'explicit_cold') {
    const semanticColdDocuments = await searchColdMemoryVectorDocuments(
      database,
      agentId,
      documents,
      normalizedQuery,
      now,
      options?.embeddingConfig,
    );
    const semanticColdResults = toMemorySearchResults(semanticColdDocuments, 'semantic_cold', now, normalizedQuery);

    return semanticColdResults.length > 0
      ? mergeDistinctMemorySearchResults(
          toMemorySearchResults(preferredGlobalDocuments, 'preferred', now, normalizedQuery),
          semanticColdResults,
        )
      : preferredResults;
  }

  if (countNonGlobalMemoryDocuments(preferredDocuments) >= 2) {
    return preferredResults;
  }

  const semanticColdDocuments = await searchColdMemoryVectorDocuments(
    database,
    agentId,
    documents,
    normalizedQuery,
    now,
    options?.embeddingConfig,
  );
  const semanticColdResults = toMemorySearchResults(semanticColdDocuments, 'semantic_cold', now, normalizedQuery);

  if (semanticColdResults.length > 0) {
    return mergeDistinctMemorySearchResults(preferredResults, semanticColdResults);
  }

  const fallbackDocuments = selectMemoryDocumentsByLayers(documents, route.fallbackLayers, now);
  return mergeDistinctMemorySearchResults(
    preferredResults,
    toMemorySearchResults(fallbackDocuments, 'fallback', now, normalizedQuery),
  );
}

export async function getAgentMemoryContext(
  agentId: string,
  options?: {
    includeRecentMemorySnapshot?: boolean;
    now?: string;
    query?: string;
    embeddingConfig?: EmbeddingProviderConfig | null;
    topicId?: string;
    includeSessionMemory?: boolean;
    includeAgentSharedShortTerm?: boolean;
  },
): Promise<string> {
  return (await getAgentMemoryContextSnapshot(agentId, options)).content;
}

export async function getAgentMemoryContextSnapshot(
  agentId: string,
  options?: {
    includeRecentMemorySnapshot?: boolean;
    now?: string;
    query?: string;
    embeddingConfig?: EmbeddingProviderConfig | null;
    topicId?: string;
    includeSessionMemory?: boolean;
    includeAgentSharedShortTerm?: boolean;
  },
): Promise<ReturnType<typeof buildLayeredMemoryContextSnapshot>> {
  const now = options?.now ?? new Date().toISOString();
  const routedDocuments = await searchMemories(agentId, options);

  return buildLayeredMemoryContextSnapshot(routedDocuments, {
    includeRecentMemorySnapshot: options?.includeRecentMemorySnapshot,
    now,
  });
}

export async function deleteAgentMemoryDocument(id: string): Promise<void> {
  const database = await ensureAgentSchema();
  database.run('DELETE FROM agent_memory_documents WHERE id = ?', [id]);
  await persistAndMaybeRebuildFts(database);
}

export async function searchWorkspace(query: string, options?: { agentId?: string }): Promise<WorkspaceSearchResult[]> {
  const database = await ensureAgentSchema();
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return [];
  }

  const results: WorkspaceSearchResult[] = [];
  const agentId = options?.agentId?.trim();

  if (isAgentWorkspaceFtsAvailable()) {
    const matchQuery = buildMatchQuery(normalizedQuery);
    if (matchQuery) {
      const topicRows = mapRows<{
        topic_id: string;
        agent_id: string;
        topic_title: string;
        agent_name: string;
      }>(
        database.exec(
          `
            SELECT
              f.topic_id,
              f.agent_id,
              t.title AS topic_title,
              a.name AS agent_name
            FROM topic_title_fts f
            JOIN topics t ON t.id = f.topic_id
            JOIN agents a ON a.id = f.agent_id
            WHERE f.title MATCH ?
              ${agentId ? 'AND f.agent_id = ?' : ''}
            LIMIT 8
          `,
          agentId ? [matchQuery, agentId] : [matchQuery],
        ),
      );

      topicRows.forEach((row) => {
        results.push({
          type: 'topic',
          topicId: row.topic_id,
          agentId: row.agent_id,
          agentName: row.agent_name,
          topicTitle: row.topic_title,
          preview: row.topic_title,
        });
      });

      const messageRows = mapRows<{
        message_id: string;
        topic_id: string;
        agent_id: string;
        content: string;
        topic_title: string;
        agent_name: string;
      }>(
        database.exec(
          `
            SELECT
              f.message_id,
              f.topic_id,
              f.agent_id,
              m.content,
              t.title AS topic_title,
              a.name AS agent_name
            FROM message_content_fts f
            JOIN topic_messages m ON m.id = f.message_id
            JOIN topics t ON t.id = f.topic_id
            JOIN agents a ON a.id = f.agent_id
            WHERE f.content MATCH ?
              ${agentId ? 'AND f.agent_id = ?' : ''}
            LIMIT 12
          `,
          agentId ? [matchQuery, agentId] : [matchQuery],
        ),
      );

      messageRows.forEach((row) => {
        results.push({
          type: 'message',
          topicId: row.topic_id,
          agentId: row.agent_id,
          agentName: row.agent_name,
          topicTitle: row.topic_title,
          preview: formatTopicPreview(row.content).slice(0, 180),
        });
      });
    }
  }

  if (results.length === 0) {
    const patterns = buildLikePatterns(normalizedQuery);
    if (patterns.length === 0) {
      return [];
    }

    const titleConditions = patterns.map(() => 't.title LIKE ?').join(' OR ');
    const titleParams = patterns.map((pattern) => pattern);
    const topicRows = mapRows<{
      topic_id: string;
      agent_id: string;
      topic_title: string;
      agent_name: string;
    }>(
      database.exec(
        `
          SELECT
            t.id AS topic_id,
            t.agent_id,
            t.title AS topic_title,
            a.name AS agent_name
          FROM topics t
          JOIN agents a ON a.id = t.agent_id
          WHERE (${titleConditions})
            ${agentId ? 'AND t.agent_id = ?' : ''}
          ORDER BY t.last_message_at DESC
          LIMIT 8
        `,
        agentId ? [...titleParams, agentId] : titleParams,
      ),
    );

    topicRows.forEach((row) => {
      results.push({
        type: 'topic',
        topicId: row.topic_id,
        agentId: row.agent_id,
        agentName: row.agent_name,
        topicTitle: row.topic_title,
        preview: row.topic_title,
      });
    });

    const messageConditions = patterns.map(() => 'm.content LIKE ?').join(' OR ');
    const messageRows = mapRows<{
      topic_id: string;
      agent_id: string;
      content: string;
      created_at: string;
      topic_title: string;
      agent_name: string;
    }>(
      database.exec(
        `
          SELECT
            m.topic_id,
            m.agent_id,
            m.content,
            m.created_at,
            t.title AS topic_title,
            a.name AS agent_name
          FROM topic_messages m
          JOIN topics t ON t.id = m.topic_id
          JOIN agents a ON a.id = m.agent_id
          WHERE (${messageConditions})
            ${agentId ? 'AND m.agent_id = ?' : ''}
          ORDER BY m.created_at DESC
          LIMIT 12
        `,
        agentId ? [...patterns, agentId] : patterns,
      ),
    );

    messageRows.forEach((row) => {
      results.push({
        type: 'message',
        topicId: row.topic_id,
        agentId: row.agent_id,
        agentName: row.agent_name,
        topicTitle: row.topic_title,
        preview: formatTopicPreview(row.content).slice(0, 180),
        createdAt: row.created_at,
      });
    });
  }

  const deduped = new Map<string, WorkspaceSearchResult>();
  results.forEach((result) => {
    const key = `${result.type}:${result.topicId}:${result.preview}`;
    if (!deduped.has(key)) {
      deduped.set(key, result);
    }
  });

  return [...deduped.values()].slice(0, 16);
}

export async function getOrCreateActiveTopic(agentId: string): Promise<TopicSummary> {
  const currentTopicId = await getActiveTopicId();
  if (currentTopicId) {
    const workspace = await getTopicWorkspace(currentTopicId);
    if (workspace && workspace.agent.id === agentId) {
      return workspace.topic;
    }
  }

  const topics = await listTopics(agentId);
  if (topics[0]) {
    await setActiveTopicId(topics[0]!.id);
    return topics[0]!;
  }

  const created = await createTopic({ agentId });
  await setActiveTopicId(created.id);
  return created;
}

export async function ensureAgentWorkspaceBootstrap() {
  const agentId = await getActiveAgentId();
  if (!agentId) {
    return null;
  }

  const agent = (await listAgents()).find((entry) => entry.id === agentId) ?? null;
  if (!agent) {
    return null;
  }

  const topic = await getOrCreateActiveTopic(agent.id);
  return { agent, topic };
}

export function getDefaultTopicPreview() {
  return DEFAULT_TOPIC_PREVIEW;
}
