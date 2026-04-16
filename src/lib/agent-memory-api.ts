import type { AgentConfig, ApiServerSettings } from './agent/config';
import {
  buildAgentMemoryPaths,
  detectMemoryFileKind,
  resolveDailyMemoryDate,
  serializeMemoryMarkdown,
  type AgentMemoryFileKind,
} from './agent-memory-files';
import {
  setAgentMemoryFileStore,
  syncAgentMemoryLifecycleFromStore,
  type AgentMemoryFileStore,
  type AgentMemoryLifecycleResult,
} from './agent-memory-sync';
import { err, isErr, ok, type Result } from './result';

export const DEFAULT_API_SERVER_BASE_URL = 'http://127.0.0.1:3850';

interface ApiPathsResponse {
  paths?: string[];
}

interface ApiFileResponse {
  content?: string;
}

interface ApiRequestError extends Error {
  status?: number;
}

export interface OfficialModelMetadataResponse {
  providerId?: string;
  providerName: string;
  model: string;
  resolverVersion?: number;
  versionLabel?: string;
  modeLabel?: string;
  contextWindow?: number;
  maxInputTokens?: number;
  maxInputCharacters?: number;
  longestReasoningTokens?: number;
  maxOutputTokens?: number;
  inputCostPerMillion?: number;
  outputCostPerMillion?: number;
  pricingNote?: string;
  excerpt?: string;
  sources: Array<{ label: string; url: string }>;
  fetchedAt: string;
  updatedAt?: string;
}

export interface ApiHealthResponse {
  ok?: boolean;
  rootDir?: string;
  nightlyArchive?: {
    enabled: boolean;
    time: string;
    cronExpression: string | null;
    useLlmScoring: boolean;
    running: boolean;
    nextRunAt: string | null;
    catchUpDue: boolean;
    lastSuccessfulRunAt: string | null;
    lastAttemptedRunAt: string | null;
    lastRunSummary: {
      processedAgents: number;
      successfulAgents: number;
      failedAgents: number;
      failures: Array<{ agentSlug: string; message: string }>;
      promotedCount: number;
      llmScoredCount: number;
      ruleFallbackCount: number;
    } | null;
  };
}

export interface NightlyArchiveRunSummary {
  processedAgents: number;
  successfulAgents: number;
  failedAgents: number;
  failures: Array<{ agentSlug: string; message: string }>;
  promotedCount: number;
  llmScoredCount: number;
  ruleFallbackCount: number;
  trigger: 'catchup' | 'scheduled' | 'manual';
  startedAt: string;
  completedAt: string;
}

export interface NightlyArchiveStatus {
  settings: {
    enabled: boolean;
    time: string;
    cronExpression: string | null;
    useLlmScoring: boolean;
  };
  state: {
    lastSuccessfulRunAt: string | null;
    lastAttemptedRunAt: string | null;
    lastRunSummary: NightlyArchiveRunSummary | null;
  };
  nextRunAt: string | null;
  catchUpDue: boolean;
  running: boolean;
}

export interface DailySummaryRunSummary {
  processedAgents: number;
  updatedFiles: number;
  skippedFiles: number;
  failedAgents: number;
  failures: Array<{ agentSlug: string; message: string }>;
  targetDate: string;
  trigger: 'catchup' | 'scheduled' | 'manual';
  startedAt: string;
  completedAt: string;
}

export interface DailySummaryStatus {
  enabled: boolean;
  schedule: string;
  state: {
    lastSuccessfulRunAt: string | null;
    lastAttemptedRunAt: string | null;
    lastRunSummary: DailySummaryRunSummary | null;
  };
  nextRunAt: string | null;
  catchUpDue: boolean;
  running: boolean;
}

export type AutomationRunStatus = NightlyArchiveStatus | DailySummaryStatus;

export interface AutomationEntry {
  id: string;
  title: string;
  description: string;
  enabled: boolean;
  schedule: string;
  running: boolean;
  nextRunAt: string | null;
  lastRunSummary: NightlyArchiveRunSummary | DailySummaryRunSummary | null;
  capabilities: string[];
}

export interface AutomationSnapshot {
  automations: AutomationEntry[];
}

export interface AgentMemoryFileEntry {
  path: string;
  kind: Exclude<AgentMemoryFileKind, 'unknown'>;
  label: string;
  exists: boolean;
  date?: string;
}

function isListedMemoryFileKind(kind: AgentMemoryFileKind): kind is Exclude<AgentMemoryFileKind, 'unknown'> {
  return kind !== 'unknown';
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

function buildApiHeaders(settings: ApiServerSettings, initHeaders?: HeadersInit) {
  const headers = new Headers(initHeaders);
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (settings.authToken.trim()) {
    headers.set('Authorization', `Bearer ${settings.authToken.trim()}`);
  }
  return headers;
}

function readErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string') {
    return payload.error;
  }
  return fallback;
}

function createApiRequestError(message: string, status?: number): ApiRequestError {
  const error = new Error(message) as ApiRequestError;
  if (typeof status === 'number') {
    error.status = status;
  }
  return error;
}

async function fetchApiResponse(
  requestUrl: string,
  init: RequestInit,
): Promise<Result<Response, Error>> {
  try {
    return ok(await fetch(requestUrl, init));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return err(createApiRequestError(`Failed to reach local API server at ${requestUrl}: ${detail}`));
  }
}

async function parseApiPayload<T>(
  response: Response,
  options: { allowNotFound?: boolean } = {},
): Promise<Result<T | null, Error>> {
  if (options.allowNotFound && response.status === 404) {
    return ok(null);
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return err(createApiRequestError(readErrorMessage(payload, `API request failed with HTTP ${response.status}.`), response.status));
  }

  return ok(payload as T);
}

async function requestApi<T>(
  settings: ApiServerSettings,
  path: string,
  init: RequestInit = {},
  options: { allowNotFound?: boolean } = {},
): Promise<T | null> {
  const baseUrl = resolveApiServerBaseUrl(settings);
  const requestUrl = `${baseUrl}${path}`;
  const responseResult = await fetchApiResponse(requestUrl, {
    ...init,
    headers: buildApiHeaders(settings, init.headers),
  });
  if (isErr(responseResult)) {
    throw responseResult.error;
  }

  const payloadResult = await parseApiPayload<T>(responseResult.value, options);
  if (isErr(payloadResult)) {
    throw payloadResult.error;
  }

  return payloadResult.value;
}

export function resolveApiServerBaseUrl(settings: ApiServerSettings) {
  const baseUrl = settings.baseUrl.trim() || DEFAULT_API_SERVER_BASE_URL;
  return trimTrailingSlash(baseUrl);
}

class ApiAgentMemoryFileStore implements AgentMemoryFileStore {
  constructor(private readonly settings: ApiServerSettings) {}

  async listPaths(prefix: string) {
    const payload = await requestApi<ApiPathsResponse>(
      this.settings,
      `/api/memory/paths?prefix=${encodeURIComponent(prefix)}`,
    );
    return payload?.paths ?? [];
  }

  async readText(path: string) {
    const payload = await requestApi<ApiFileResponse>(
      this.settings,
      `/api/memory/file?path=${encodeURIComponent(path)}`,
      {},
      { allowNotFound: true },
    );
    return typeof payload?.content === 'string' ? payload.content : null;
  }

  async writeText(path: string, content: string) {
    await requestApi(this.settings, '/api/memory/file', {
      method: 'PUT',
      body: JSON.stringify({ path, content }),
    });
  }

  async deleteText(path: string) {
    await requestApi(this.settings, `/api/memory/file?path=${encodeURIComponent(path)}`, {
      method: 'DELETE',
    });
  }
}

export function createAgentMemoryApiFileStore(settings: ApiServerSettings): AgentMemoryFileStore | null {
  if (!settings.enabled) {
    return null;
  }
  return new ApiAgentMemoryFileStore(settings);
}

export function registerConfiguredAgentMemoryFileStore(settings: ApiServerSettings) {
  setAgentMemoryFileStore(createAgentMemoryApiFileStore(settings));
}

export async function getApiServerHealth(settings: ApiServerSettings): Promise<ApiHealthResponse | null> {
  if (!settings.enabled) {
    return null;
  }

  return requestApi<ApiHealthResponse>(settings, '/health', {}, { allowNotFound: true });
}

export async function getNightlyArchiveStatus(settings: ApiServerSettings): Promise<NightlyArchiveStatus | null> {
  if (!settings.enabled) {
    return null;
  }

  return requestApi<NightlyArchiveStatus>(settings, '/api/nightly-archive', {}, { allowNotFound: true });
}

export async function saveNightlyArchiveSettings(
  settings: ApiServerSettings,
  value: { enabled?: boolean; time?: string; cronExpression?: string | null; useLlmScoring?: boolean },
): Promise<NightlyArchiveStatus | null> {
  if (!settings.enabled) {
    throw new Error('The local API server is disabled.');
  }

  return requestApi<NightlyArchiveStatus>(settings, '/api/nightly-archive', {
    method: 'PUT',
    body: JSON.stringify(value),
  });
}

export async function runNightlyArchiveNow(settings: ApiServerSettings): Promise<NightlyArchiveStatus | null> {
  if (!settings.enabled) {
    throw new Error('The local API server is disabled.');
  }

  return requestApi<NightlyArchiveStatus>(settings, '/api/nightly-archive/run', {
    method: 'POST',
  });
}

export async function getAutomationSnapshot(settings: ApiServerSettings): Promise<AutomationSnapshot | null> {
  if (!settings.enabled) {
    return null;
  }

  return requestApi<AutomationSnapshot>(settings, '/api/automations', {}, { allowNotFound: true });
}

export async function runAutomation(
  settings: ApiServerSettings,
  automationId: string,
): Promise<AutomationRunStatus | null> {
  if (!settings.enabled) {
    throw new Error('The local API server is disabled.');
  }

  return requestApi<NightlyArchiveStatus>(settings, `/api/automations/${encodeURIComponent(automationId)}/run`, {
    method: 'POST',
  });
}

export async function getProjectConfig(settings: ApiServerSettings): Promise<AgentConfig | null> {
  if (!settings.enabled) {
    return null;
  }

  return requestApi<AgentConfig>(settings, '/api/config', {}, { allowNotFound: true });
}

export async function saveProjectConfig(
  settings: ApiServerSettings,
  value: Partial<AgentConfig> | AgentConfig,
): Promise<AgentConfig | null> {
  if (!settings.enabled) {
    throw new Error('The local API server is disabled.');
  }

  return requestApi<AgentConfig>(settings, '/api/config', {
    method: 'PUT',
    body: JSON.stringify(value),
  });
}

export async function inspectOfficialModelMetadata(
  settings: ApiServerSettings,
  providerId: string,
  providerName: string,
  model: string,
  options: { refresh?: boolean } = {},
): Promise<OfficialModelMetadataResponse | null> {
  if (!settings.enabled) {
    return null;
  }

  try {
    return await requestApi<OfficialModelMetadataResponse>(
      settings,
      `/api/model-inspector?providerId=${encodeURIComponent(providerId)}&providerName=${encodeURIComponent(providerName)}&model=${encodeURIComponent(model)}${options.refresh ? '&refresh=true' : ''}`,
      {},
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if ((error as ApiRequestError | undefined)?.status === 404 || message.includes('HTTP 404')) {
      throw new Error('当前本地 API Server 版本过旧，缺少 /api/model-inspector。请重启 `npm run api-server` 或 `npm run dev`。');
    }
    throw error;
  }
}

export async function listStoredModelMetadata(
  settings: ApiServerSettings,
  providerId: string,
): Promise<Record<string, OfficialModelMetadataResponse>> {
  if (!settings.enabled) {
    return {};
  }

  const payload = await requestApi<{ entries?: Record<string, OfficialModelMetadataResponse> }>(
    settings,
    `/api/model-metadata?providerId=${encodeURIComponent(providerId)}`,
    {},
    { allowNotFound: true },
  );
  return payload?.entries ?? {};
}

export async function saveStoredModelMetadata(
  settings: ApiServerSettings,
  input: {
    providerId: string;
    providerName: string;
    model: string;
    metadata: Partial<OfficialModelMetadataResponse>;
  },
): Promise<OfficialModelMetadataResponse | null> {
  if (!settings.enabled) {
    return null;
  }

  return requestApi<OfficialModelMetadataResponse>(settings, '/api/model-metadata', {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

function createMemoryTemplate(agentName: string) {
  return serializeMemoryMarkdown({
    frontmatter: {
      title: `${agentName} Memory`,
      updatedAt: new Date().toISOString(),
    },
    body: '',
  });
}

function createCorrectionsTemplate(agentName: string) {
  return serializeMemoryMarkdown({
    frontmatter: {
      title: `${agentName} Corrections`,
      kind: 'corrections',
      updatedAt: new Date().toISOString(),
    },
    body: '## Active Corrections\n',
  });
}

function createReflectionsTemplate(agentName: string) {
  return serializeMemoryMarkdown({
    frontmatter: {
      title: `${agentName} Reflections`,
      kind: 'reflections',
      updatedAt: new Date().toISOString(),
    },
    body: '## Active Reflections\n',
  });
}

function createDailyTemplate(date: string) {
  return serializeMemoryMarkdown({
    frontmatter: {
      date,
      title: `${date} Daily Memory`,
      updatedAt: new Date().toISOString(),
    },
    body: '',
  });
}

export async function listAgentMemoryFiles(
  agentSlug: string,
  settings: ApiServerSettings,
): Promise<AgentMemoryFileEntry[]> {
  const fileStore = createAgentMemoryApiFileStore(settings);
  if (!fileStore) {
    return [];
  }

  const today = new Date().toISOString().slice(0, 10);
  const paths = buildAgentMemoryPaths(agentSlug, today);
  const memoryExists = (await fileStore.readText(paths.memoryFile)) !== null;
  const correctionsExists = (await fileStore.readText(paths.correctionsFile)) !== null;
  const reflectionsExists = (await fileStore.readText(paths.reflectionsFile)) !== null;
  const dailyPaths = (await fileStore.listPaths(paths.dailyDir))
    .map((path) => ({ path, kind: detectMemoryFileKind(path) }))
    .filter((entry): entry is { path: string; kind: Exclude<AgentMemoryFileKind, 'unknown'> } =>
      isListedMemoryFileKind(entry.kind),
    )
    .sort((left, right) => right.path.localeCompare(left.path));

  return [
    {
      path: paths.memoryFile,
      kind: 'memory',
      label: 'MEMORY.md',
      exists: memoryExists,
    },
    {
      path: paths.correctionsFile,
      kind: 'corrections',
      label: 'corrections.md',
      exists: correctionsExists,
    },
    {
      path: paths.reflectionsFile,
      kind: 'reflections',
      label: 'reflections.md',
      exists: reflectionsExists,
    },
    ...dailyPaths.map(({ path, kind }) => {
      const date = resolveDailyMemoryDate(path);
      return {
        path,
        kind,
        label: date
          ? kind === 'daily_source'
            ? `${date}.md`
            : `${date}.${kind === 'daily_warm' ? 'warm' : 'cold'}.md`
          : path.split('/').pop() ?? path,
        exists: true,
        date,
      };
    }),
  ];
}

export async function readAgentMemoryFile(path: string, settings: ApiServerSettings): Promise<string | null> {
  const fileStore = createAgentMemoryApiFileStore(settings);
  if (!fileStore) {
    throw new Error('The local API server is disabled.');
  }

  return fileStore.readText(path);
}

export async function writeAgentMemoryFile(path: string, content: string, settings: ApiServerSettings) {
  const fileStore = createAgentMemoryApiFileStore(settings);
  if (!fileStore) {
    throw new Error('The local API server is disabled.');
  }

  await fileStore.writeText(path, content);
}

export async function deleteAgentMemoryFile(path: string, settings: ApiServerSettings) {
  if (!settings.enabled) {
    throw new Error('The local API server is disabled.');
  }

  await requestApi(settings, `/api/memory/file?path=${encodeURIComponent(path)}`, {
    method: 'DELETE',
  });
}

export async function ensureAgentMemoryFile(
  input: {
    agentSlug: string;
    agentName: string;
    kind: 'memory' | 'daily' | 'corrections' | 'reflections';
    date?: string;
  },
  settings: ApiServerSettings,
) {
  const today = input.date ?? new Date().toISOString().slice(0, 10);
  const paths = buildAgentMemoryPaths(input.agentSlug, today);
  const targetPath =
    input.kind === 'memory'
      ? paths.memoryFile
      : input.kind === 'corrections'
        ? paths.correctionsFile
        : input.kind === 'reflections'
          ? paths.reflectionsFile
          : paths.dailyFile;
  const existing = await readAgentMemoryFile(targetPath, settings);
  if (existing !== null) {
    return {
      path: targetPath,
      content: existing,
    };
  }

  const content =
    input.kind === 'memory'
      ? createMemoryTemplate(input.agentName)
      : input.kind === 'corrections'
        ? createCorrectionsTemplate(input.agentName)
        : input.kind === 'reflections'
          ? createReflectionsTemplate(input.agentName)
          : createDailyTemplate(today);

  await writeAgentMemoryFile(targetPath, content, settings);
  return {
    path: targetPath,
    content,
  };
}

export async function syncAgentMemoryLifecycleForAgent(
  agentSlug: string,
  settings: ApiServerSettings,
  now?: string,
): Promise<AgentMemoryLifecycleResult> {
  const fileStore = createAgentMemoryApiFileStore(settings);
  if (!fileStore) {
    throw new Error('The local API server is disabled.');
  }

  return syncAgentMemoryLifecycleFromStore({
    agentSlug,
    fileStore,
    now,
  });
}
