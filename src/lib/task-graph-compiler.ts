import { type AgentConfig, resolveModelSelection } from './agent/config';
import { getProviderRequestMode, normalizeBaseUrl } from './provider-compatibility';
import { err, isErr, ok, type Result } from './result';

export type TaskGraphNodeType = 'planner' | 'dispatcher' | 'worker' | 'reviewer';
export type TaskGraphCompilerStrategy = 'llm' | 'fallback';

export interface CompiledTaskGraphNode {
  key: string;
  type: TaskGraphNodeType;
  title: string;
  objective: string;
  acceptanceCriteria: string;
  dependsOn: string[];
}

export interface CompiledTaskGraphEdge {
  from: string;
  to: string;
  type: 'plans' | 'dispatches' | 'reviews';
}

export interface CompiledTaskGraph {
  title: string;
  goal: string;
  summary: string;
  compilerStrategy: TaskGraphCompilerStrategy;
  nodes: CompiledTaskGraphNode[];
  edges: CompiledTaskGraphEdge[];
}

interface CompilerWorkerPlan {
  title: string;
  objective: string;
  acceptanceCriteria: string;
}

interface CompilerPlanPayload {
  title: string;
  summary: string;
  workers: CompilerWorkerPlan[];
}

const TASK_GRAPH_JSON_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    summary: { type: 'string' },
    workers: {
      type: 'array',
      minItems: 1,
      maxItems: 4,
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          objective: { type: 'string' },
          acceptanceCriteria: { type: 'string' },
        },
        required: ['title', 'objective', 'acceptanceCriteria'],
        additionalProperties: false,
      },
    },
  },
  required: ['title', 'summary', 'workers'],
  additionalProperties: false,
} as const;

function buildCompilerMessages(goal: string, topicTitle?: string) {
  return [
    {
      role: 'system',
      content: [
        'You compile user goals into a compact execution graph for FlowAgent.',
        'Return only a task plan for planner -> dispatcher -> worker branches -> reviewer.',
        'Your job is only to split the goal into 1-4 worker branches.',
        'Each worker should be parallel-friendly, concrete, and independently reviewable.',
        'Avoid creating redundant workers or vague tasks.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        topicTitle ? `Current topic: ${topicTitle}` : '',
        `Goal:\n${goal.trim()}`,
        'Generate a concise workflow title, a short overall summary, and 1-4 worker tasks.',
        'Acceptance criteria should be concrete and easy to verify.',
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
  ];
}

function normalizeLine(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}

function slugifyKey(text: string, fallback: string) {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 36);
  return slug || fallback;
}

function normalizeWorkerPlan(worker: Partial<CompilerWorkerPlan>, index: number): CompilerWorkerPlan {
  const title = normalizeLine(worker.title || `Worker ${index + 1}`);
  const objective = normalizeLine(worker.objective || title);
  const acceptanceCriteria = normalizeLine(
    worker.acceptanceCriteria || 'Produce a concrete, reviewable result for this branch.',
  );
  return {
    title,
    objective,
    acceptanceCriteria,
  };
}

function parseCompilerPlanPayload(rawContent: string) {
  try {
    return JSON.parse(rawContent) as Partial<CompilerPlanPayload>;
  } catch (error) {
    const preview = rawContent.trim().slice(0, 240) || '(empty response)';
    throw new Error(`The model returned invalid workflow JSON: ${preview}`, {
      cause: error instanceof Error ? error : undefined,
    });
  }
}

function buildGraphFromPlan(input: {
  goal: string;
  title?: string;
  summary?: string;
  workers: CompilerWorkerPlan[];
  compilerStrategy: TaskGraphCompilerStrategy;
}): CompiledTaskGraph {
  const graphTitle = normalizeLine(input.title || input.goal.slice(0, 48) || 'Workflow Plan');
  const graphSummary = normalizeLine(
    input.summary || 'Break the goal into branchable worker tasks, then merge and review the outputs.',
  );
  const normalizedWorkers = input.workers.slice(0, 4).map(normalizeWorkerPlan);

  const workerNodes: CompiledTaskGraphNode[] = normalizedWorkers.map((worker, index) => ({
    key: `worker_${index + 1}_${slugifyKey(worker.title, `worker_${index + 1}`)}`,
    type: 'worker',
    title: worker.title,
    objective: worker.objective,
    acceptanceCriteria: worker.acceptanceCriteria,
    dependsOn: ['dispatcher'],
  }));

  const nodes: CompiledTaskGraphNode[] = [
    {
      key: 'planner',
      type: 'planner',
      title: 'Planner',
      objective: `Clarify execution scope for "${graphTitle}" and keep worker boundaries stable.`,
      acceptanceCriteria: 'Worker breakdown is coherent, non-overlapping, and aligned with the user goal.',
      dependsOn: [],
    },
    {
      key: 'dispatcher',
      type: 'dispatcher',
      title: 'Dispatcher',
      objective: 'Coordinate the worker branches, track branch readiness, and collect branch outputs.',
      acceptanceCriteria: 'Each worker branch has a concrete objective and a place to report back.',
      dependsOn: ['planner'],
    },
    ...workerNodes,
    {
      key: 'reviewer',
      type: 'reviewer',
      title: 'Reviewer',
      objective: 'Review the combined branch outputs for correctness, gaps, and consistency.',
      acceptanceCriteria: 'A final merged result can be handed back without obvious conflicts or missing checks.',
      dependsOn: workerNodes.map((node) => node.key),
    },
  ];

  const edges: CompiledTaskGraphEdge[] = [
    { from: 'planner', to: 'dispatcher', type: 'plans' },
    ...workerNodes.map((node) => ({ from: 'dispatcher', to: node.key, type: 'dispatches' as const })),
    ...workerNodes.map((node) => ({ from: node.key, to: 'reviewer', type: 'reviews' as const })),
  ];

  return {
    title: graphTitle,
    goal: normalizeLine(input.goal),
    summary: graphSummary,
    compilerStrategy: input.compilerStrategy,
    nodes,
    edges,
  };
}

function splitGoalIntoFallbackWorkers(goal: string) {
  const normalized = goal
    .split(/\r?\n+/)
    .flatMap((line) => line.split(/[;；。]\s*/))
    .map(normalizeLine)
    .filter(Boolean);

  const candidates = normalized.filter((line) => line.length > 8).slice(0, 4);
  if (candidates.length > 0) {
    return candidates.map((line, index) => ({
      title: line.length > 36 ? `${line.slice(0, 34)}...` : line,
      objective: line,
      acceptanceCriteria: `Complete branch ${index + 1} with a concrete output directly addressing: ${line}`,
    }));
  }

  return [
    {
      title: 'Primary implementation',
      objective: goal.trim(),
      acceptanceCriteria: 'Produce the main deliverable requested by the user.',
    },
  ];
}

function fallbackTaskGraph(goal: string, title?: string) {
  const workers = splitGoalIntoFallbackWorkers(goal);
  return buildGraphFromPlan({
    goal,
    title,
    summary: 'Fallback workflow generated without model-side structured compilation.',
    workers,
    compilerStrategy: 'fallback',
  });
}

function extractResponsesOutputText(payload: any) {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text;
  }

  const content = payload?.output
    ?.flatMap((item: any) => item?.content ?? [])
    ?.find((entry: any) => typeof entry?.text === 'string' && entry.text.trim());

  return typeof content?.text === 'string' ? content.text : '';
}

async function requestCompilerPayload(
  url: string,
  init: RequestInit,
): Promise<Result<Record<string, any>, Error>> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return err(new Error(detail));
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = payload?.error?.message || payload?.message || `HTTP ${response.status}`;
    return err(new Error(reason));
  }

  return ok(payload);
}

async function requestTaskPlanViaProvider(input: {
  config: AgentConfig;
  providerId?: string;
  model?: string;
  goal: string;
  title?: string;
  topicTitle?: string;
}): Promise<CompiledTaskGraph> {
  const { provider, model } = resolveModelSelection(input.config, input.providerId, input.model);
  const requestMode = getProviderRequestMode(provider.protocol);
  const baseUrl = normalizeBaseUrl(provider.baseUrl);

  if (provider.type === 'anthropic' || !baseUrl || !provider.apiKey) {
    throw new Error('The current provider cannot compile a structured task graph in the current runtime.');
  }

  const messages = buildCompilerMessages(input.goal, input.topicTitle);
  let rawContent = '';

  if (requestMode === 'responses') {
    const payloadResult = await requestCompilerPayload(`${baseUrl}/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: messages,
        text: {
          format: {
            type: 'json_schema',
            name: 'flowagent_task_plan',
            schema: TASK_GRAPH_JSON_SCHEMA,
            strict: true,
          },
        },
      }),
    });
    if (isErr(payloadResult)) {
      throw payloadResult.error;
    }

    rawContent = extractResponsesOutputText(payloadResult.value);
  } else {
    const payloadResult = await requestCompilerPayload(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'flowagent_task_plan',
            schema: TASK_GRAPH_JSON_SCHEMA,
            strict: true,
          },
        },
      }),
    });
    if (isErr(payloadResult)) {
      throw payloadResult.error;
    }

    rawContent = String(payloadResult.value?.choices?.[0]?.message?.content ?? '');
  }

  const parsed = parseCompilerPlanPayload(rawContent);
  const workers = Array.isArray(parsed.workers) ? parsed.workers.map(normalizeWorkerPlan).slice(0, 4) : [];
  if (workers.length === 0) {
    throw new Error('The model returned no worker tasks.');
  }

  return buildGraphFromPlan({
    goal: input.goal,
    title: normalizeLine(parsed.title || input.title || ''),
    summary: normalizeLine(parsed.summary || ''),
    workers,
    compilerStrategy: 'llm',
  });
}

export async function compileTaskGraphFromGoal(input: {
  config: AgentConfig;
  providerId?: string;
  model?: string;
  goal: string;
  title?: string;
  topicTitle?: string;
}): Promise<CompiledTaskGraph> {
  try {
    return await requestTaskPlanViaProvider(input);
  } catch (error) {
    console.warn('Falling back to deterministic task graph compiler:', error);
    return fallbackTaskGraph(input.goal, input.title);
  }
}
