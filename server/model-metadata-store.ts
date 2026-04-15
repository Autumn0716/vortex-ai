import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { ModelInspectorResult } from './model-inspector';
import { wrapErrorWithContext } from '../src/lib/error-details';

export interface StoredModelMetadataEntry extends ModelInspectorResult {
  providerId?: string;
  updatedAt: string;
}

interface StoredModelMetadataFile {
  version: 1;
  updatedAt: string;
  entries: Record<string, StoredModelMetadataEntry>;
}

const DEFAULT_STORE: StoredModelMetadataFile = {
  version: 1,
  updatedAt: new Date(0).toISOString(),
  entries: {},
};

function normalizeKeyPart(value: string) {
  return value.trim().toLowerCase();
}

export function createModelMetadataStoreKey(providerId: string, model: string) {
  return `${normalizeKeyPart(providerId)}::${normalizeKeyPart(model)}`;
}

export function getModelMetadataStorePath(rootDir: string) {
  return path.join(rootDir, 'model-metadata.json');
}

async function ensureStoreDirectory(rootDir: string) {
  await mkdir(path.dirname(getModelMetadataStorePath(rootDir)), { recursive: true });
}

async function readStore(rootDir: string): Promise<StoredModelMetadataFile> {
  try {
    const raw = await readFile(getModelMetadataStorePath(rootDir), 'utf8');
    const parsed = JSON.parse(raw) as Partial<StoredModelMetadataFile>;
    return {
      version: 1,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : DEFAULT_STORE.updatedAt,
      entries:
        parsed.entries && typeof parsed.entries === 'object'
          ? (parsed.entries as Record<string, StoredModelMetadataEntry>)
          : {},
    };
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'ENOENT'
    ) {
      return DEFAULT_STORE;
    }
    throw wrapErrorWithContext(`Failed to read model metadata store at ${getModelMetadataStorePath(rootDir)}`, error);
  }
}

async function writeStore(rootDir: string, store: StoredModelMetadataFile) {
  await ensureStoreDirectory(rootDir);
  await writeFile(getModelMetadataStorePath(rootDir), `${JSON.stringify(store, null, 2)}\n`, 'utf8');
}

export async function listStoredModelMetadata(
  rootDir: string,
  providerId: string,
): Promise<Record<string, StoredModelMetadataEntry>> {
  const store = await readStore(rootDir);
  const normalizedProviderId = normalizeKeyPart(providerId);
  return Object.values(store.entries)
    .filter((entry) => normalizeKeyPart(entry.providerId ?? '') === normalizedProviderId)
    .reduce<Record<string, StoredModelMetadataEntry>>((accumulator, entry) => {
      accumulator[entry.model] = entry;
      return accumulator;
    }, {});
}

export async function readStoredModelMetadata(
  rootDir: string,
  providerId: string,
  model: string,
): Promise<StoredModelMetadataEntry | null> {
  const store = await readStore(rootDir);
  return store.entries[createModelMetadataStoreKey(providerId, model)] ?? null;
}

export async function writeStoredModelMetadata(
  rootDir: string,
  providerId: string,
  model: string,
  value: ModelInspectorResult | StoredModelMetadataEntry,
): Promise<StoredModelMetadataEntry> {
  const store = await readStore(rootDir);
  const nextTimestamp = new Date().toISOString();
  const entry: StoredModelMetadataEntry = {
    ...value,
    providerId,
    model,
    updatedAt: nextTimestamp,
  };
  store.entries[createModelMetadataStoreKey(providerId, model)] = entry;
  store.updatedAt = nextTimestamp;
  await writeStore(rootDir, store);
  return entry;
}

export async function patchStoredModelMetadata(
  rootDir: string,
  providerId: string,
  providerName: string,
  model: string,
  value: Partial<StoredModelMetadataEntry>,
): Promise<StoredModelMetadataEntry> {
  const existing = await readStoredModelMetadata(rootDir, providerId, model);
  const nextTimestamp = new Date().toISOString();
  const entry: StoredModelMetadataEntry = {
    providerId,
    providerName: value.providerName ?? existing?.providerName ?? providerName,
    model,
    versionLabel: value.versionLabel ?? existing?.versionLabel,
    modeLabel: value.modeLabel ?? existing?.modeLabel,
    resolverVersion: value.resolverVersion ?? existing?.resolverVersion,
    contextWindow: value.contextWindow ?? existing?.contextWindow,
    maxInputTokens: value.maxInputTokens ?? existing?.maxInputTokens,
    maxInputCharacters: value.maxInputCharacters ?? existing?.maxInputCharacters,
    longestReasoningTokens:
      value.longestReasoningTokens ?? existing?.longestReasoningTokens,
    maxOutputTokens: value.maxOutputTokens ?? existing?.maxOutputTokens,
    inputCostPerMillion: value.inputCostPerMillion ?? existing?.inputCostPerMillion,
    outputCostPerMillion: value.outputCostPerMillion ?? existing?.outputCostPerMillion,
    pricingNote: value.pricingNote ?? existing?.pricingNote,
    excerpt: value.excerpt ?? existing?.excerpt,
    sources: value.sources ?? existing?.sources ?? [],
    fetchedAt: value.fetchedAt ?? existing?.fetchedAt ?? nextTimestamp,
    updatedAt: nextTimestamp,
  };
  return writeStoredModelMetadata(rootDir, providerId, model, entry);
}
