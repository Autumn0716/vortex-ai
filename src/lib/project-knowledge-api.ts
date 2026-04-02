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
