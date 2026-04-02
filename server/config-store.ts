import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { DEFAULT_CONFIG, normalizeAgentConfig, type AgentConfig } from '../src/lib/agent/config';

export function getConfigFilePath(rootDir: string) {
  return path.join(rootDir, 'config.json');
}

async function ensureConfigDirectory(rootDir: string) {
  await mkdir(rootDir, { recursive: true });
}

async function writeConfigFile(rootDir: string, config: AgentConfig) {
  await ensureConfigDirectory(rootDir);
  await writeFile(getConfigFilePath(rootDir), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

export async function readProjectConfig(rootDir: string): Promise<AgentConfig> {
  const configFilePath = getConfigFilePath(rootDir);

  try {
    const raw = await readFile(configFilePath, 'utf8');
    return normalizeAgentConfig(JSON.parse(raw) as Partial<AgentConfig>);
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }

    const config = normalizeAgentConfig(DEFAULT_CONFIG);
    await writeConfigFile(rootDir, config);
    return config;
  }
}

export async function writeProjectConfig(
  rootDir: string,
  value: Partial<AgentConfig> | AgentConfig,
): Promise<AgentConfig> {
  const config = normalizeAgentConfig(value);
  await writeConfigFile(rootDir, config);
  return config;
}

function isMissingFileError(error: unknown) {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'ENOENT',
  );
}
