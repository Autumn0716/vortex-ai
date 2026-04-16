import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import type { Server } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { promisify } from 'node:util';

import { createFlowAgentApiServer, resolveAllowedPath } from '../server/api-server';
import {
  getApiServerHealth,
  getAutomationSnapshot,
  getNightlyArchiveStatus,
  exportAgentPackage as exportAgentPackageViaApi,
  importAgentPackage as importAgentPackageViaApi,
  inspectOfficialModelMetadata,
  listStoredModelMetadata,
  listAgentMemoryFiles,
  readAgentMemoryFile,
  registerConfiguredAgentMemoryFileStore,
  runNightlyArchiveNow,
  runAutomation,
  saveNightlyArchiveSettings,
  saveStoredModelMetadata,
  writeAgentMemoryFile,
} from '../src/lib/agent-memory-api';
import { getAgentMemoryFileStore, setAgentMemoryFileStore } from '../src/lib/agent-memory-sync';

const tempRoots: string[] = [];
const execFileAsync = promisify(execFile);
const silentLogger = {
  info() {},
  warn() {},
  error() {},
};

after(async () => {
  setAgentMemoryFileStore(null);
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
});

async function createTempRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'flowagent-api-'));
  tempRoots.push(root);
  return root;
}

async function startServer(
  rootDir: string,
  authToken = '',
  nightlyArchiveNow?: () => string | Date,
  logger?: Pick<Console, 'info' | 'warn' | 'error'>,
) {
  const {
    app,
    nightlyArchiveReady,
    nightlyArchiveScheduler,
    dailySummaryReady,
    dailySummaryScheduler,
    weeklyArchiveReady,
    weeklyArchiveScheduler,
  } = createFlowAgentApiServer({
    rootDir,
    authToken,
    nightlyArchiveNow,
    logger: logger ?? silentLogger,
  });
  await Promise.all([nightlyArchiveReady, dailySummaryReady, weeklyArchiveReady]);
  const server = await new Promise<Server>((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    instance.on('error', reject);
  });
  const address = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      nightlyArchiveScheduler.stop();
      dailySummaryScheduler.stop();
      weeklyArchiveScheduler.stop();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

test('resolveAllowedPath only permits memory files under memory/agents', () => {
  const allowed = resolveAllowedPath('/tmp/project', 'memory/agents/flowagent-core/MEMORY.md');
  assert.match(allowed.absolutePath, /memory\/agents\/flowagent-core\/MEMORY\.md$/);

  assert.throws(() => resolveAllowedPath('/tmp/project', '../secrets.txt'), /Only memory\/agents paths are allowed|Invalid path/);
  assert.throws(
    () => resolveAllowedPath('/tmp/project', 'memory/agents/flowagent-core/notes.txt', { allowDirectory: false }),
    /Only Markdown memory files are allowed/,
  );
});

test('API server health and file operations work through the registered memory file store', async () => {
  const rootDir = await createTempRoot();
  const server = await startServer(rootDir);
  const settings = {
    enabled: true,
    baseUrl: server.baseUrl,
    authToken: '',
  };

  try {
    const health = await getApiServerHealth(settings);
    assert.equal(health?.ok, true);
    assert.equal(health?.rootDir, rootDir);
    assert.equal(health?.nightlyArchive?.enabled, false);
    assert.equal(health?.nightlyArchive?.time, '03:00');
    assert.equal(health?.nightlyArchive?.cronExpression, null);
    assert.equal(health?.nightlyArchive?.useLlmScoring, false);
    assert.equal(health?.nightlyArchive?.lastRunSummary?.promotedCount ?? 0, 0);

    registerConfiguredAgentMemoryFileStore(settings);
    const fileStore = getAgentMemoryFileStore();
    assert.ok(fileStore);

    await fileStore!.writeText('memory/agents/flowagent-core/MEMORY.md', '# Memory\n\n默认使用中文输出。');
    await fileStore!.writeText(
      'memory/agents/flowagent-core/daily/2026-04-01.md',
      '# 2026-04-01\n\n- TODO: verify file-backed runtime.',
    );

    assert.equal(
      await fileStore!.readText('memory/agents/flowagent-core/MEMORY.md'),
      '# Memory\n\n默认使用中文输出。',
    );
    assert.deepEqual(await fileStore!.listPaths('memory/agents/flowagent-core'), [
      'memory/agents/flowagent-core/MEMORY.md',
      'memory/agents/flowagent-core/daily/2026-04-01.md',
    ]);

    const diskContent = await readFile(path.join(rootDir, 'memory/agents/flowagent-core/MEMORY.md'), 'utf8');
    assert.equal(diskContent, '# Memory\n\n默认使用中文输出。');
  } finally {
    await server.close();
  }
});

test('API server logs request method path status and duration without query strings', async () => {
  const rootDir = await createTempRoot();
  const logs: string[] = [];
  const logger = {
    info(message: string) {
      logs.push(message);
    },
    warn() {},
    error() {},
  };
  const server = await startServer(rootDir, '', undefined, logger);

  try {
    const response = await fetch(`${server.baseUrl}/health?authToken=secret-token`);
    assert.equal(response.status, 200);
    await response.text();

    assert.equal(logs.length, 1);
    assert.match(logs[0], /^\[api\] GET \/health 200 \d+ms$/);
    assert.doesNotMatch(logs[0], /secret-token|authToken/);
  } finally {
    await server.close();
  }
});

test('API server exposes readable and writable nightly archive settings', async () => {
  const rootDir = await createTempRoot();
  const server = await startServer(rootDir);
  const settings = {
    enabled: true,
    baseUrl: server.baseUrl,
    authToken: '',
  };

  try {
    const initialStatus = await getNightlyArchiveStatus(settings);
    assert.equal(initialStatus?.settings.enabled, false);
    assert.equal(initialStatus?.settings.time, '03:00');
    assert.equal(initialStatus?.settings.cronExpression, null);
    assert.equal(initialStatus?.settings.useLlmScoring, false);

    const nextStatus = await saveNightlyArchiveSettings(settings, {
      enabled: true,
      time: '04:30',
      cronExpression: '15 4 * * *',
      useLlmScoring: true,
    });
    assert.equal(nextStatus?.settings.enabled, true);
    assert.equal(nextStatus?.settings.time, '04:30');
    assert.equal(nextStatus?.settings.cronExpression, '15 4 * * *');
    assert.equal(nextStatus?.settings.useLlmScoring, true);

    const settingsFile = await readFile(path.join(rootDir, '.flowagent/nightly-memory-archive-settings.json'), 'utf8');
    assert.match(settingsFile, /"time": "04:30"/);
    assert.match(settingsFile, /"cronExpression": "15 4 \* \* \*"/);

    const health = await getApiServerHealth(settings);
    assert.equal(health?.nightlyArchive?.enabled, true);
    assert.equal(health?.nightlyArchive?.time, '04:30');
    assert.equal(health?.nightlyArchive?.cronExpression, '15 4 * * *');
    assert.equal(health?.nightlyArchive?.useLlmScoring, true);
    assert.equal(health?.nightlyArchive?.lastRunSummary?.promotedCount ?? 0, 0);

    const runStatus = await runNightlyArchiveNow(settings);
    assert.equal(runStatus?.state.lastRunSummary?.trigger, 'manual');
    assert.equal(runStatus?.state.lastRunSummary?.processedAgents, 0);

    const automationSnapshot = await getAutomationSnapshot(settings);
    const nightlyAutomation = automationSnapshot?.automations.find((automation) => automation.id === 'nightly_archive');
    const weeklyAutomation = automationSnapshot?.automations.find((automation) => automation.id === 'weekly_archive');
    const codeReviewAutomation = automationSnapshot?.automations.find((automation) => automation.id === 'code_review');
    assert.equal(nightlyAutomation?.schedule, 'cron 15 4 * * *');
    assert.equal(weeklyAutomation?.schedule, '每周日 04:00');
    assert.equal(codeReviewAutomation?.schedule, 'git pre-push / 手动');

    const automationRunStatus = await runAutomation(settings, 'nightly_archive');
    assert.equal(automationRunStatus?.state.lastRunSummary?.trigger, 'manual');

    await assert.rejects(() => runAutomation(settings, 'missing'), /Unknown automation: missing/);
  } finally {
    await server.close();
  }
});

test('API automation registry can run the code review automation', async () => {
  const rootDir = await createTempRoot();
  await execFileAsync('git', ['init'], { cwd: rootDir });
  const server = await startServer(rootDir, '', () => '2026-04-16T10:00:00.000Z');
  const settings = {
    enabled: true,
    baseUrl: server.baseUrl,
    authToken: '',
  };

  try {
    const runStatus = await runAutomation(settings, 'code_review');
    assert.equal(runStatus?.state.lastRunSummary?.trigger, 'manual');
    assert.equal(runStatus?.state.lastRunSummary?.failedAgents, 0);

    const codeReviewState = await readFile(path.join(rootDir, '.flowagent/code-review-state.json'), 'utf8');
    assert.match(codeReviewState, /"reviewNotes"/);
  } finally {
    await server.close();
  }
});

test('API automation registry can run the weekly archive wrapper', async () => {
  const rootDir = await createTempRoot();
  await mkdir(path.join(rootDir, 'memory/agents/core/daily'), { recursive: true });
  await writeFile(
    path.join(rootDir, 'memory/agents/core/daily/2026-04-10.md'),
    '- TODO weekly archive should reuse nightly lifecycle.',
    'utf8',
  );
  const server = await startServer(rootDir, '', () => '2026-04-20T12:00:00.000Z');
  const settings = {
    enabled: true,
    baseUrl: server.baseUrl,
    authToken: '',
  };

  try {
    const automationSnapshot = await getAutomationSnapshot(settings);
    const weeklyAutomation = automationSnapshot?.automations.find((automation) => automation.id === 'weekly_archive');
    assert.equal(weeklyAutomation?.schedule, '每周日 04:00');

    const runStatus = await runAutomation(settings, 'weekly_archive');
    assert.equal(runStatus?.state.lastRunSummary?.trigger, 'manual');
    assert.equal(runStatus?.state.lastRunSummary?.processedAgents, 1);

    const weeklyState = await readFile(path.join(rootDir, '.flowagent/weekly-archive-state.json'), 'utf8');
    assert.match(weeklyState, /"promotedCount"/);
  } finally {
    await server.close();
  }
});

test('API automation registry can generate yesterday daily summaries', async () => {
  const rootDir = await createTempRoot();
  await mkdir(path.join(rootDir, 'memory/agents/core/daily'), { recursive: true });
  await writeFile(
    path.join(rootDir, 'memory/agents/core/daily/2026-04-15.md'),
    '- [09:00] You: 需要继续做自动化触发器。\n- [09:30] Assistant: 已完成 cron 设置。\n- [10:00] TODO 接入昨日会话摘要。',
    'utf8',
  );
  const server = await startServer(rootDir, '', () => '2026-04-16T07:30:00.000Z');
  const settings = {
    enabled: true,
    baseUrl: server.baseUrl,
    authToken: '',
  };

  try {
    const automationSnapshot = await getAutomationSnapshot(settings);
    const dailyAutomation = automationSnapshot?.automations.find((automation) => automation.id === 'daily_summary');
    assert.equal(dailyAutomation?.schedule, '每天 08:00');

    const runStatus = await runAutomation(settings, 'daily_summary');
    assert.equal(runStatus?.state.lastRunSummary?.trigger, 'manual');
    assert.equal(runStatus?.state.lastRunSummary?.processedAgents, 1);

    const dailyFile = await readFile(path.join(rootDir, 'memory/agents/core/daily/2026-04-15.md'), 'utf8');
    assert.match(dailyFile, /flowagent:daily-summary:start/);
    assert.match(dailyFile, /Summary:/);
    assert.match(dailyFile, /Open Loops:/);
    assert.match(dailyFile, /自动化触发器/);
  } finally {
    await server.close();
  }
});

test('API server exports and imports FlowAgent agent packages', async () => {
  const rootDir = await createTempRoot();
  await mkdir(path.join(rootDir, 'memory/agents/core/daily'), { recursive: true });
  await mkdir(path.join(rootDir, 'skills/review'), { recursive: true });
  await writeFile(path.join(rootDir, 'memory/agents/core/MEMORY.md'), '# Core Memory\n', 'utf8');
  await writeFile(path.join(rootDir, 'skills/review/SKILL.md'), '# Review Skill\n', 'utf8');
  const server = await startServer(rootDir);
  const settings = {
    enabled: true,
    baseUrl: server.baseUrl,
    authToken: '',
  };

  try {
    const packageData = await exportAgentPackageViaApi(settings, 'core');
    assert.equal(packageData?.format, 'flowagent.package');
    assert.ok(packageData?.memoryFiles.some((file) => file.path === 'memory/agents/core/MEMORY.md'));
    assert.ok(packageData?.skillFiles.some((file) => file.path === 'skills/review/SKILL.md'));

    const result = await importAgentPackageViaApi(settings, packageData!, {
      targetAgentSlug: 'clone',
    });
    assert.equal(result?.agentSlug, 'clone');
    assert.equal(await readFile(path.join(rootDir, 'memory/agents/clone/MEMORY.md'), 'utf8'), '# Core Memory\n');
  } finally {
    await server.close();
  }
});

test('API file helpers respect auth token protection', async () => {
  const rootDir = await createTempRoot();
  const server = await startServer(rootDir, 'secret-token');
  const authorized = {
    enabled: true,
    baseUrl: server.baseUrl,
    authToken: 'secret-token',
  };
  const unauthorized = {
    enabled: true,
    baseUrl: server.baseUrl,
    authToken: '',
  };

  try {
    await writeAgentMemoryFile('memory/agents/flowagent-core/MEMORY.md', 'Authenticated write.', authorized);
    assert.equal(
      await readAgentMemoryFile('memory/agents/flowagent-core/MEMORY.md', authorized),
      'Authenticated write.',
    );

    await assert.rejects(
      () => readAgentMemoryFile('memory/agents/flowagent-core/MEMORY.md', unauthorized),
      /Unauthorized/,
    );

    const unauthorizedResponse = await fetch(
      `${server.baseUrl}/api/memory/file?path=memory/agents/flowagent-core/MEMORY.md`,
    );
    assert.equal(unauthorizedResponse.status, 401);
    assert.deepEqual(await unauthorizedResponse.json(), {
      error: 'Unauthorized.',
      error_code: 'AUTH_UNAUTHORIZED',
    });
  } finally {
    await server.close();
  }
});

test('API validation errors include stable error_code fields', async () => {
  const rootDir = await createTempRoot();
  const server = await startServer(rootDir);

  try {
    const response = await fetch(`${server.baseUrl}/api/model-metadata`);

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: 'providerId is required.',
      error_code: 'MODEL_METADATA_INVALID_REQUEST',
    });
  } finally {
    await server.close();
  }
});

test('API model metadata read errors include contextual file details', async () => {
  const rootDir = await createTempRoot();
  await writeFile(path.join(rootDir, 'model-metadata.json'), '{"entries": ', 'utf8');
  const server = await startServer(rootDir);

  try {
    const response = await fetch(`${server.baseUrl}/api/model-metadata?providerId=aliyun_responses`);

    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: `Failed to read model metadata store at ${path.join(rootDir, 'model-metadata.json')}`,
      error_code: 'MODEL_METADATA_READ_FAILED',
    });
  } finally {
    await server.close();
  }
});

test('API model metadata write errors return 500 when the local store is malformed', async () => {
  const rootDir = await createTempRoot();
  await writeFile(path.join(rootDir, 'model-metadata.json'), '{"entries": ', 'utf8');
  const server = await startServer(rootDir);

  try {
    const response = await fetch(`${server.baseUrl}/api/model-metadata`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providerId: 'aliyun_responses',
        providerName: 'Aliyun',
        model: 'qwen3.6plus',
        metadata: {
          contextWindow: 1000000,
        },
      }),
    });

    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: `Failed to read model metadata store at ${path.join(rootDir, 'model-metadata.json')}`,
      error_code: 'MODEL_METADATA_WRITE_FAILED',
    });
  } finally {
    await server.close();
  }
});

test('API memory file listing includes warm and cold surrogate markdown files', async () => {
  const rootDir = await createTempRoot();
  const server = await startServer(rootDir);
  const settings = {
    enabled: true,
    baseUrl: server.baseUrl,
    authToken: '',
  };

  try {
    await writeAgentMemoryFile('memory/agents/flowagent-core/MEMORY.md', '# Memory', settings);
    await writeAgentMemoryFile('memory/agents/flowagent-core/daily/2026-04-01.md', '# Source', settings);
    await writeAgentMemoryFile('memory/agents/flowagent-core/daily/2026-04-01.warm.md', '# Warm', settings);
    await writeAgentMemoryFile('memory/agents/flowagent-core/daily/2026-04-01.cold.md', '# Cold', settings);

    const files = await listAgentMemoryFiles('flowagent-core', settings);
    assert.deepEqual(
      files.filter((file) => file.path.includes('/daily/')).map((file) => [file.path, file.kind, file.label]),
      [
        ['memory/agents/flowagent-core/daily/2026-04-01.warm.md', 'daily_warm', '2026-04-01.warm.md'],
        ['memory/agents/flowagent-core/daily/2026-04-01.md', 'daily_source', '2026-04-01.md'],
        ['memory/agents/flowagent-core/daily/2026-04-01.cold.md', 'daily_cold', '2026-04-01.cold.md'],
      ],
    );
  } finally {
    await server.close();
  }
});

test('API memory file listing includes bootstrap correction and reflection files', async () => {
  const rootDir = await createTempRoot();
  const server = await startServer(rootDir);
  const settings = {
    enabled: true,
    baseUrl: server.baseUrl,
    authToken: '',
  };

  try {
    await writeAgentMemoryFile('memory/agents/flowagent-core/MEMORY.md', '# Memory', settings);

    const files = await listAgentMemoryFiles('flowagent-core', settings);
    assert.deepEqual(
      files.slice(0, 3).map((file) => [file.path, file.kind, file.label, file.exists]),
      [
        ['memory/agents/flowagent-core/MEMORY.md', 'memory', 'MEMORY.md', true],
        ['memory/agents/flowagent-core/corrections.md', 'corrections', 'corrections.md', false],
        ['memory/agents/flowagent-core/reflections.md', 'reflections', 'reflections.md', false],
      ],
    );
  } finally {
    await server.close();
  }
});

test('API server exposes official model inspector results', async () => {
  const rootDir = await createTempRoot();
  const server = await startServer(rootDir);
  const settings = {
    enabled: true,
    baseUrl: server.baseUrl,
    authToken: '',
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    if (typeof input === 'string' && input.startsWith(server.baseUrl)) {
      return originalFetch(input, init);
    }
    return new Response(
      '<html><body><h1>gpt-4.1-mini</h1><div>1,047,576 context window</div><div>32,768 max output tokens</div><div>Input $0.40</div><div>Output $1.60</div></body></html>',
      { status: 200, headers: { 'Content-Type': 'text/html' } },
    );
  }) as typeof fetch;

  try {
    const result = await inspectOfficialModelMetadata(
      settings,
      'provider_openai',
      'OpenAI',
      'gpt-4.1-mini',
    );
    assert.equal(result?.contextWindow, 1047576);
    assert.equal(result?.maxOutputTokens, 32768);
    assert.equal(result?.inputCostPerMillion, 0.4);
    assert.equal(result?.outputCostPerMillion, 1.6);
  } finally {
    globalThis.fetch = originalFetch;
    await server.close();
  }
});

test('model inspector 404 is rewritten to a local upgrade hint', async () => {
  const settings = {
    enabled: true,
    baseUrl: 'http://127.0.0.1:3850',
    authToken: '',
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    if (typeof input === 'string' && input.includes('/api/model-inspector')) {
      return new Response(JSON.stringify({ error: 'Not found.' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return originalFetch(input);
  }) as typeof fetch;

  try {
    await assert.rejects(
      () => inspectOfficialModelMetadata(settings, 'provider_openai', 'OpenAI', 'gpt-4.1-mini'),
      /当前本地 API Server 版本过旧，缺少 \/api\/model-inspector/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('API model inspector returns contextual errors when the cached metadata store is malformed', async () => {
  const rootDir = await createTempRoot();
  await writeFile(path.join(rootDir, 'model-metadata.json'), '{"entries": ', 'utf8');
  const server = await startServer(rootDir);

  try {
    const response = await fetch(
      `${server.baseUrl}/api/model-inspector?providerId=aliyun_responses&providerName=Aliyun&model=qwen3.6plus`,
    );

    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: `Failed to read model metadata store at ${path.join(rootDir, 'model-metadata.json')}`,
      error_code: 'MODEL_INSPECTOR_FAILED',
    });
  } finally {
    await server.close();
  }
});

test('API server persists detected model metadata and allows manual overrides', async () => {
  const rootDir = await createTempRoot();
  const server = await startServer(rootDir);
  const settings = {
    enabled: true,
    baseUrl: server.baseUrl,
    authToken: '',
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    if (typeof input === 'string' && input.startsWith(server.baseUrl)) {
      return originalFetch(input, init);
    }
    return new Response(
      '<html><body>qwen3.6-plus 当前与qwen3.6-plus-2026-04-02能力相同 默认开启思考模式 Batch调用半价 稳定版 思考 1,000,000 983,616 81,920 65,536 阶梯计价，请参见表格下方说明。 非思考 991,808 - qwen3.6-plus-2026-04-02 快照版 思考 983,616 81,920 非思考 991,808 - 以上模型根据本次请求输入的 Token数，采取阶梯计费。 Qwen3.6-Plus Qwen3.5-Plus Qwen-Plus 单次请求的输入Token数 输入价格（每百万Token） 输出价格（每百万Token） 0&lt;Token≤256K 2元 12元 256K&lt;Token≤1M 8元 48元</body></html>',
      { status: 200, headers: { 'Content-Type': 'text/html' } },
    );
  }) as typeof fetch;

  try {
    const detected = await inspectOfficialModelMetadata(settings, 'aliyun_responses', 'Aliyun', 'qwen3.6plus', {
      refresh: true,
    });
    assert.equal(detected?.contextWindow, 1000000);

    const stored = await listStoredModelMetadata(settings, 'aliyun_responses');
    assert.equal(stored['qwen3.6plus']?.contextWindow, 1000000);

    const saved = await saveStoredModelMetadata(settings, {
      providerId: 'aliyun_responses',
      providerName: 'Aliyun',
      model: 'qwen3.6plus',
      metadata: {
        contextWindow: 888888,
        maxOutputTokens: 65536,
        pricingNote: '手工修订',
      },
    });
    assert.equal(saved?.contextWindow, 888888);
    assert.equal(saved?.pricingNote, '手工修订');

    const refreshed = await listStoredModelMetadata(settings, 'aliyun_responses');
    assert.equal(refreshed['qwen3.6plus']?.contextWindow, 888888);

    const storeRaw = await readFile(path.join(rootDir, 'model-metadata.json'), 'utf8');
    assert.match(storeRaw, /"contextWindow": 888888/);
    assert.match(storeRaw, /"pricingNote": "手工修订"/);
  } finally {
    globalThis.fetch = originalFetch;
    await server.close();
  }
});
