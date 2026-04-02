import type { ApiServerSettings } from './agent/config';
import { resolveApiServerBaseUrl } from './agent-memory-api';
import type { ProjectKnowledgeRecord } from './project-knowledge-model';

export interface ProjectKnowledgeStatus {
  version: string;
  documentCount: number;
  paths: string[];
}

export interface ProjectKnowledgeSnapshot extends ProjectKnowledgeStatus {
  documents: ProjectKnowledgeRecord[];
}

function buildApiHeaders(settings: ApiServerSettings, initHeaders?: HeadersInit) {
  const headers = new Headers(initHeaders);
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

async function requestProjectKnowledgeApi<T>(settings: ApiServerSettings, path: string) {
  if (!settings.enabled) {
    return null;
  }

  const response = await fetch(`${resolveApiServerBaseUrl(settings)}${path}`, {
    headers: buildApiHeaders(settings),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(readErrorMessage(payload, `API request failed with HTTP ${response.status}.`));
  }
  return payload as T;
}

export async function getProjectKnowledgeStatus(settings: ApiServerSettings) {
  return requestProjectKnowledgeApi<ProjectKnowledgeStatus>(settings, '/api/project-knowledge/status');
}

export async function getProjectKnowledgeSnapshot(settings: ApiServerSettings) {
  return requestProjectKnowledgeApi<ProjectKnowledgeSnapshot>(settings, '/api/project-knowledge/documents');
}

export function subscribeProjectKnowledgeEvents(
  settings: ApiServerSettings,
  handlers: {
    onStatus: (status: ProjectKnowledgeStatus) => void;
    onError?: (error: Error) => void;
  },
) {
  if (!settings.enabled) {
    return () => {};
  }

  const baseUrl = resolveApiServerBaseUrl(settings);
  const url = new URL(`${baseUrl}/api/project-knowledge/events`);
  if (settings.authToken.trim()) {
    url.searchParams.set('authToken', settings.authToken.trim());
  }

  const source = new EventSource(url.toString());
  source.addEventListener('project-knowledge', (event) => {
    try {
      handlers.onStatus(JSON.parse((event as MessageEvent).data) as ProjectKnowledgeStatus);
    } catch (error) {
      handlers.onError?.(error instanceof Error ? error : new Error('Failed to parse project knowledge event.'));
    }
  });
  source.onerror = () => {
    handlers.onError?.(new Error('Project knowledge event stream disconnected.'));
  };

  return () => {
    source.close();
  };
}
