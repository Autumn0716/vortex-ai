import type { ApiServerSettings } from './agent/config';
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

export const DEFAULT_API_SERVER_BASE_URL = 'http://127.0.0.1:3850';

interface ApiPathsResponse {
  paths?: string[];
}

interface ApiFileResponse {
  content?: string;
}

interface ApiHealthResponse {
  ok?: boolean;
  rootDir?: string;
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

async function requestApi<T>(
  settings: ApiServerSettings,
  path: string,
  init: RequestInit = {},
  options: { allowNotFound?: boolean } = {},
): Promise<T | null> {
  const baseUrl = resolveApiServerBaseUrl(settings);
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: buildApiHeaders(settings, init.headers),
  });

  if (options.allowNotFound && response.status === 404) {
    return null;
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(readErrorMessage(payload, `API request failed with HTTP ${response.status}.`));
  }

  return payload as T;
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

function createMemoryTemplate(agentName: string) {
  return serializeMemoryMarkdown({
    frontmatter: {
      title: `${agentName} Memory`,
      updatedAt: new Date().toISOString(),
    },
    body: '',
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
    kind: 'memory' | 'daily';
    date?: string;
  },
  settings: ApiServerSettings,
) {
  const today = input.date ?? new Date().toISOString().slice(0, 10);
  const paths = buildAgentMemoryPaths(input.agentSlug, today);
  const targetPath = input.kind === 'memory' ? paths.memoryFile : paths.dailyFile;
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
