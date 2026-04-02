# Config File Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move app configuration from browser-only storage to a project-local `config.json`, accessed through the local host layer and ready for a later Electron host.

**Architecture:** Add a shared file-backed config module that owns `config.json` and `config.example.json`, then expose it through the local `api-server`. Switch frontend config helpers to read and write through that API, with a one-time migration from legacy browser `agent_config_v3` when `config.json` is missing. Add a single local development command that starts both Vite and the `api-server` so host-backed config works without manual double startup.

**Tech Stack:** React 19, Vite, TypeScript, Express, localforage (legacy migration only), Node fs/path, existing Settings UI and local API server

---

### Task 1: Add the file-backed config store and project templates

**Files:**
- Create: `server/config-store.ts`
- Create: `config.example.json`
- Modify: `.gitignore`
- Test: `tests/config-store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  getConfigFilePath,
  readProjectConfig,
  writeProjectConfig,
} from '../server/config-store';

test('readProjectConfig creates config.json from defaults when missing', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'flowagent-config-store-'));
  const config = await readProjectConfig(rootDir);

  assert.equal(getConfigFilePath(rootDir), path.join(rootDir, 'config.json'));
  assert.equal(config.apiServer.baseUrl, 'http://127.0.0.1:3850');

  const written = JSON.parse(await readFile(path.join(rootDir, 'config.json'), 'utf8'));
  assert.equal(written.apiServer.baseUrl, 'http://127.0.0.1:3850');
});

test('writeProjectConfig persists normalized config to config.json', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'flowagent-config-store-write-'));
  const saved = await writeProjectConfig(rootDir, {
    apiServer: { enabled: true, baseUrl: 'http://127.0.0.1:3850' },
  });

  assert.equal(saved.apiServer.enabled, true);
  const written = JSON.parse(await readFile(path.join(rootDir, 'config.json'), 'utf8'));
  assert.equal(written.apiServer.enabled, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/config-store.test.ts`
Expected: FAIL with module-not-found for `server/config-store.ts`

- [ ] **Step 3: Write minimal implementation**

```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { DEFAULT_CONFIG, normalizeAgentConfig, type AgentConfig } from '../src/lib/agent/config';

export function getConfigFilePath(rootDir: string) {
  return path.join(rootDir, 'config.json');
}

export async function readProjectConfig(rootDir: string): Promise<AgentConfig> {
  // Read config.json if present.
  // If missing, create it from DEFAULT_CONFIG.
  // Normalize before returning.
}

export async function writeProjectConfig(rootDir: string, value: Partial<AgentConfig> | AgentConfig) {
  // Normalize and write config.json with stable 2-space JSON.
}
```

- [ ] **Step 4: Add the template and ignore rule**

```json
// config.example.json
{
  "activeProviderId": "openai",
  "activeModel": "gpt-4o",
  "apiServer": {
    "enabled": true,
    "baseUrl": "http://127.0.0.1:3850",
    "authToken": ""
  }
}
```

```gitignore
# Local application config
config.json
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --import tsx --test tests/config-store.test.ts tests/agent-config.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/config-store.ts config.example.json .gitignore tests/config-store.test.ts
git commit -m "feat: add project config file store"
```

### Task 2: Expose config through the local api-server

**Files:**
- Modify: `server/api-server.ts`
- Modify: `src/lib/agent-memory-api.ts`
- Test: `tests/config-api.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createFlowAgentApiServer } from '../server/api-server';

test('api-server exposes readable and writable config.json endpoints', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'flowagent-config-api-'));
  const { app, nightlyArchiveScheduler } = createFlowAgentApiServer({ rootDir });
  const server = app.listen(0, '127.0.0.1');

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to resolve test server address.');
  }

  const response = await fetch(`http://127.0.0.1:${address.port}/api/config`);
  const payload = await response.json();
  assert.equal(payload.apiServer.baseUrl, 'http://127.0.0.1:3850');

  nightlyArchiveScheduler.stop();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/config-api.test.ts`
Expected: FAIL with 404 for `/api/config`

- [ ] **Step 3: Add the routes and client helpers**

```ts
// server/api-server.ts
app.get('/api/config', async (_request, response) => {
  response.json(await readProjectConfig(rootDir));
});

app.put('/api/config', async (request, response) => {
  response.json(await writeProjectConfig(rootDir, request.body ?? {}));
});
```

```ts
// src/lib/agent-memory-api.ts
export async function getProjectConfig(settings: ApiServerSettings) {
  return requestApi<AgentConfig>(settings, '/api/config');
}

export async function saveProjectConfig(settings: ApiServerSettings, value: AgentConfig) {
  return requestApi<AgentConfig>(settings, '/api/config', {
    method: 'PUT',
    body: JSON.stringify(value),
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test tests/config-api.test.ts tests/agent-memory-api.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/api-server.ts src/lib/agent-memory-api.ts tests/config-api.test.ts
git commit -m "feat: expose file-backed config through api-server"
```

### Task 3: Switch frontend config helpers to host-backed config with legacy migration

**Files:**
- Modify: `src/lib/agent/config.ts`
- Test: `tests/agent-config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test('readConfigFromHost migrates legacy browser config when config.json is missing', async () => {
  const legacy = normalizeAgentConfig({
    activeProviderId: 'openai',
    activeModel: 'gpt-4o',
    memory: { includeRecentMemorySnapshot: false },
  });

  const writes: AgentConfig[] = [];
  const config = await loadConfigWithMigration({
    readLegacyConfig: async () => legacy,
    readHostConfig: async () => null,
    writeHostConfig: async (value) => {
      writes.push(value);
      return value;
    },
  });

  assert.equal(config.memory.includeRecentMemorySnapshot, false);
  assert.equal(writes.length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/agent-config.test.ts`
Expected: FAIL because config helpers still read/write `localforage` directly

- [ ] **Step 3: Refactor config loading and saving**

```ts
// src/lib/agent/config.ts
export async function getAgentConfig(): Promise<AgentConfig> {
  // Try host-backed config first.
  // If unavailable, fall back to legacy browser config.
  // If host is available and legacy config exists while file config is missing,
  // migrate once and return the migrated file-backed config.
}

export async function saveAgentConfig(config: AgentConfig): Promise<void> {
  // Save through the host bridge when available.
  // If host is unavailable, throw a concrete error instead of pretending persistence worked.
}
```

- [ ] **Step 4: Keep localforage only for legacy read compatibility**

```ts
const LEGACY_CONFIG_KEY = 'agent_config_v3';

async function readLegacyAgentConfig() {
  return normalizeAgentConfig(await localforage.getItem<AgentConfig>(LEGACY_CONFIG_KEY));
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --import tsx --test tests/agent-config.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/agent/config.ts tests/agent-config.test.ts
git commit -m "feat: migrate frontend config to host-backed file store"
```

### Task 4: Update app and settings flows to surface host-backed persistence clearly

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/settings/SettingsView.tsx`
- Verify against: `src/components/ChatInterface.tsx`
- Test: `tests/config-api.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test('saving config through the Settings flow fails clearly when the host bridge is unavailable', async () => {
  // Simulate getAgentConfig falling back to defaults and saveAgentConfig throwing.
  // Expect the settings flow to preserve the draft and surface a concrete error message.
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/config-api.test.ts`
Expected: FAIL because the current flow assumes browser persistence always succeeds

- [ ] **Step 3: Update runtime boot and settings messaging**

```ts
// src/App.tsx
getAgentConfig()
  .then((config) => applyThemePreferences(config))
  .catch((error) => {
    console.error('Failed to load file-backed config:', error);
    applyThemePreferences(normalizeAgentConfig());
  });

// src/components/settings/SettingsView.tsx
// Keep the current draft behavior, but surface host-backed save failures clearly.
// Reuse the existing API server summary area to explain whether file-backed config is available.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test tests/config-api.test.ts tests/agent-memory-api.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/components/settings/SettingsView.tsx tests/config-api.test.ts
git commit -m "feat: surface file-backed config availability in the ui"
```

### Task 5: Add one-command local startup and finish docs

**Files:**
- Modify: `package.json`
- Create: `scripts/dev-all.mjs`
- Modify: `README.md`
- Modify: `docs/CHANGELOG.md`
- Modify: `todo-list.md`

- [ ] **Step 1: Write the failing smoke check**

```bash
npm run dev:all
```

Expected: FAIL because no combined startup command exists yet

- [ ] **Step 2: Add the combined startup command**

```js
// scripts/dev-all.mjs
import { spawn } from 'node:child_process';

const api = spawn('npm', ['run', 'api-server'], { stdio: 'inherit', shell: true });
const web = spawn('npm', ['run', 'dev'], { stdio: 'inherit', shell: true });

for (const child of [api, web]) {
  child.on('exit', (code) => {
    if (code && code !== 0) {
      process.exitCode = code;
    }
  });
}
```

```json
// package.json
"scripts": {
  "dev:all": "node scripts/dev-all.mjs"
}
```

- [ ] **Step 3: Update docs**

```md
- document `config.json` as the local/private config source
- document `config.example.json` as the committed template
- document that `dev:all` starts both Vite and the local api-server
- add a todo progress note for config migration to file source
```

- [ ] **Step 4: Run verification**

Run: `node --import tsx --test tests/config-store.test.ts tests/config-api.test.ts tests/agent-config.test.ts tests/agent-memory-api.test.ts`
Expected: PASS

Run: `npm run lint`
Expected: PASS

Run: `npm run dev:all`
Expected: Vite and the local `api-server` both start successfully

- [ ] **Step 5: Commit**

```bash
git add package.json scripts/dev-all.mjs README.md docs/CHANGELOG.md todo-list.md
git commit -m "feat: add file-backed config startup flow"
```

## Self-Review

- Spec coverage: Task 1 covers the shared file-backed config module and templates. Task 2 covers the `api-server` config endpoints. Task 3 covers frontend host-backed config plus one-time legacy migration. Task 4 covers runtime/UI behavior when the host bridge is unavailable. Task 5 covers one-command startup plus docs.
- Placeholder scan: no `TODO`/`TBD` placeholders remain in implementation steps.
- Type consistency: `readProjectConfig`, `writeProjectConfig`, `getProjectConfig`, and `saveProjectConfig` are used consistently across the plan, and `config.json` remains the sole file-backed config target throughout.
