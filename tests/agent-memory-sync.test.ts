import assert from 'node:assert/strict';
import test from 'node:test';

import initSqlite from '@sqlite.org/sqlite-wasm';
import localforage from 'localforage';

import {
  setAgentMemoryFileStore,
  syncAgentMemoryFromStore,
  type AgentMemoryFileStore,
} from '../src/lib/agent-memory-sync';
import { ensureAgentWorkspaceSchema } from '../src/lib/agent-workspace-schema';
import { buildAgentMemoryPaths } from '../src/lib/agent-memory-files';
import {
  getAgentBootstrapMemoryContext,
  getAgentMemoryContext,
  saveAgent,
  searchMemories,
  syncCurrentAgentMemory,
} from '../src/lib/agent-workspace';
import { Database, initDB } from '../src/lib/db';
import type { EmbeddingProviderConfig } from '../src/lib/embedding-client';

const localforageState = new Map<string, unknown>();

localforage.getItem = async <T>(key: string) => (localforageState.has(key) ? (localforageState.get(key) as T) : null);
localforage.setItem = async <T>(key: string, value: T) => {
  localforageState.set(key, value);
  return value;
};
localforage.removeItem = async (key: string) => {
  localforageState.delete(key);
};

class InMemoryFileStore implements AgentMemoryFileStore {
  writes: string[] = [];

  constructor(private readonly files = new Map<string, string>()) {}

  async readText(path: string) {
    return this.files.get(path) ?? null;
  }

  async writeText(path: string, content: string) {
    this.writes.push(path);
    this.files.set(path, content);
  }

  async listPaths(prefix: string) {
    return [...this.files.keys()].filter((path) => path.startsWith(prefix)).sort();
  }
}

async function setupMemoryContextAgent(
  agentId: string,
  workspaceRelpath: string,
  files: Map<string, string>,
) {
  await saveAgent({
    id: agentId,
    name: agentId,
    description: 'Memory context router test agent',
    systemPrompt: 'System prompt',
    accentColor: 'from-emerald-500/20 to-teal-500/20',
    workspaceRelpath,
  });

  setAgentMemoryFileStore(new InMemoryFileStore(files));
}

function createDatabase() {
  return initSqlite().then((sqlite3) => {
    const database = new Database(sqlite3, new sqlite3.oo1.DB(':memory:', 'c'));
    ensureAgentWorkspaceSchema(database);
    database.run(
      `
        INSERT INTO agents (
          id,
          slug,
          name,
          description,
          system_prompt,
          provider_id,
          model,
          accent_color,
          workspace_relpath,
          is_default,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        'agent_flowagent_core',
        'flowagent-core',
        'FlowAgent Core',
        'Test agent',
        'System prompt',
        null,
        null,
        'from-blue-500/20 to-violet-500/20',
        'agents/flowagent-core',
        1,
        '2026-04-01T00:00:00.000Z',
        '2026-04-01T00:00:00.000Z',
      ],
    );
    return database;
  });
}

function selectDerivedRows(database: Database) {
  return (
    database.exec(
      `
        SELECT id, title, content, memory_scope, source_type, event_date, created_at, updated_at
        FROM agent_memory_documents
        WHERE agent_id = ?
        ORDER BY memory_scope ASC, event_date ASC
      `,
      ['agent_flowagent_core'],
    )[0]?.values ?? []
  );
}

function selectColdEmbeddingRows(database: Database) {
  return (
    database.exec(
      `
        SELECT
          memory_document_id,
          agent_id,
          event_date,
          source_type,
          embedding_model,
          embedding_dimensions,
          content_hash,
          content_preview
        FROM agent_memory_embeddings
        ORDER BY event_date ASC
      `,
    )[0]?.values ?? []
  );
}

const TEST_EMBEDDING_CONFIG: EmbeddingProviderConfig = {
  apiKey: 'test-key',
  model: 'test-embedding',
  baseUrl: 'https://example.invalid/v1',
  dimensions: 3,
  encodingFormat: 'float',
};

function installEmbeddingFetchMock(routes: Array<{ match: string; embedding: number[] }>) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { input?: string | string[] };
    const input = Array.isArray(body.input) ? body.input.join('\n') : String(body.input ?? '');
    const route = routes.find((candidate) => input.includes(candidate.match));
    if (!route) {
      throw new Error(`No embedding mock configured for input: ${input}`);
    }

    return {
      ok: true,
      async json() {
        return {
          data: [{ index: 0, embedding: route.embedding }],
          model: 'test-embedding',
        };
      },
    } as Response;
  }) as typeof fetch;

  return () => {
    globalThis.fetch = originalFetch;
  };
}

test('syncAgentMemoryFromStore upserts derived rows for long-term and daily markdown files', async () => {
  const database = await createDatabase();

  const paths = buildAgentMemoryPaths('flowagent-core', '2026-04-01');
  const fileStore = new InMemoryFileStore(
    new Map([
      [
        paths.memoryFile,
        '---\n' +
          'title: "Working Preferences"\n' +
          '---\n\n' +
          'Keep answers terse.\nPrefer SQLite as derived state only.',
      ],
      [
        paths.dailyFile,
        '---\n' +
          'title: "2026-04-01 Daily Log"\n' +
          '---\n\n' +
          '- Investigated startup sync.\n- TODO: verify markdown migration.',
      ],
    ]),
  );

  await syncAgentMemoryFromStore(database, {
    agentId: 'agent_flowagent_core',
    agentSlug: 'flowagent-core',
    fileStore,
    now: '2026-04-01T09:00:00.000Z',
  });

  const firstPass = selectDerivedRows(database);

  assert.equal(firstPass.length, 2);
  assert.deepEqual(firstPass, [
    [
      firstPass[0]?.[0],
      '2026-04-01 Daily Log',
      '- Investigated startup sync.\n- TODO: verify markdown migration.',
      'daily',
      'conversation_log',
      '2026-04-01',
      '2026-04-01T23:59:59.999Z',
      '2026-04-01T23:59:59.999Z',
    ],
    [
      firstPass[1]?.[0],
      'Working Preferences',
      'Keep answers terse.\nPrefer SQLite as derived state only.',
      'global',
      'manual',
      null,
      '2026-04-01T09:00:00.000Z',
      '2026-04-01T09:00:00.000Z',
    ],
  ]);

  await fileStore.writeText(
    paths.memoryFile,
    '---\n' +
      'title: "Working Preferences"\n' +
      '---\n\n' +
      'Keep answers terser still.\nPrefer Markdown as source of truth.',
  );
  await fileStore.writeText(
    paths.dailyFile,
    '---\n' +
      'title: "2026-04-01 Daily Log"\n' +
      '---\n\n' +
      '- Investigated startup sync.\n- Shipped derived SQLite sync.',
  );

  await syncAgentMemoryFromStore(database, {
    agentId: 'agent_flowagent_core',
    agentSlug: 'flowagent-core',
    fileStore,
    now: '2026-04-01T10:00:00.000Z',
  });

  const secondPass = selectDerivedRows(database);

  assert.equal(secondPass.length, 2);
  assert.deepEqual(secondPass, [
    [
      firstPass[0]?.[0],
      '2026-04-01 Daily Log',
      '- Investigated startup sync.\n- Shipped derived SQLite sync.',
      'daily',
      'conversation_log',
      '2026-04-01',
      '2026-04-01T23:59:59.999Z',
      '2026-04-01T23:59:59.999Z',
    ],
    [
      firstPass[1]?.[0],
      'Working Preferences',
      'Keep answers terser still.\nPrefer Markdown as source of truth.',
      'global',
      'manual',
      null,
      '2026-04-01T09:00:00.000Z',
      '2026-04-01T10:00:00.000Z',
    ],
  ]);

  database.close();
});

test('syncAgentMemoryFromStore indexes corrections and reflections bootstrap files', async () => {
  const database = await createDatabase();
  const paths = buildAgentMemoryPaths('flowagent-core', '2026-04-01');
  const fileStore = new InMemoryFileStore(
    new Map([
      [
        paths.correctionsFile,
        '---\n' +
          'title: "Agent Corrections"\n' +
          'kind: "corrections"\n' +
          '---\n\n' +
          '## Active Corrections\n\n' +
          '- Rule: 不要把 todo-list.md 纳入 git。',
      ],
      [
        paths.reflectionsFile,
        '---\n' +
          'title: "Agent Reflections"\n' +
          'kind: "reflections"\n' +
          '---\n\n' +
          '## Active Reflections\n\n' +
          '- Lesson: 配置变更要同时检查 web、api-server、desktop。',
      ],
    ]),
  );

  await syncAgentMemoryFromStore(database, {
    agentId: 'agent_flowagent_core',
    agentSlug: 'flowagent-core',
    fileStore,
    now: '2026-04-01T09:00:00.000Z',
  });

  const rowsBySourceType = new Map(selectDerivedRows(database).map((row) => [row[4], row]));
  const correction = rowsBySourceType.get('correction');
  const reflection = rowsBySourceType.get('reflection');

  assert.equal(correction?.[1], 'Agent Corrections');
  assert.match(String(correction?.[2] ?? ''), /不要把 todo-list\.md 纳入 git/);
  assert.equal(correction?.[3], 'global');
  assert.equal(correction?.[6], '2026-04-01T09:00:00.000Z');

  assert.equal(reflection?.[1], 'Agent Reflections');
  assert.match(String(reflection?.[2] ?? ''), /配置变更要同时检查/);
  assert.equal(reflection?.[3], 'global');
  assert.equal(reflection?.[6], '2026-04-01T09:00:00.000Z');
});

test('syncAgentMemoryFromStore is idempotent when markdown content is unchanged', async () => {
  const database = await createDatabase();
  const paths = buildAgentMemoryPaths('flowagent-core', '2026-04-01');
  const fileStore = new InMemoryFileStore(
    new Map([
      [paths.memoryFile, '---\ntitle: "Working Preferences"\n---\n\nKeep answers terse.'],
      [paths.dailyFile, '---\ntitle: "2026-04-01 Daily Log"\n---\n\n- Investigated startup sync.'],
    ]),
  );

  const first = await syncAgentMemoryFromStore(database, {
    agentId: 'agent_flowagent_core',
    agentSlug: 'flowagent-core',
    fileStore,
    now: '2026-04-01T09:00:00.000Z',
  });
  const rowsAfterFirst = selectDerivedRows(database);

  const second = await syncAgentMemoryFromStore(database, {
    agentId: 'agent_flowagent_core',
    agentSlug: 'flowagent-core',
    fileStore,
    now: '2026-04-01T10:00:00.000Z',
  });
  const rowsAfterSecond = selectDerivedRows(database);

  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.deepEqual(rowsAfterSecond, rowsAfterFirst);
  assert.deepEqual(fileStore.writes, []);

  database.close();
});

test('syncAgentMemoryFromStore chooses effective rows based on the date tier', async () => {
  const database = await createDatabase();
  const hotPaths = buildAgentMemoryPaths('flowagent-core', '2026-04-19');
  const warmPaths = buildAgentMemoryPaths('flowagent-core', '2026-04-10');
  const coldPaths = buildAgentMemoryPaths('flowagent-core', '2026-03-01');
  const orphanPaths = buildAgentMemoryPaths('flowagent-core', '2026-03-05');
  const fileStore = new InMemoryFileStore(
    new Map([
      [hotPaths.dailyFile, '---\ntitle: "2026-04-19 Daily Log"\n---\n\n- Hot source detail.'],
      [hotPaths.warmFile, '---\ntitle: "2026-04-19 Warm Memory"\n---\n\nHot warm detail.'],
      [hotPaths.coldFile, '---\ntitle: "2026-04-19 Cold Memory"\n---\n\nHot stale cold detail.'],
      [warmPaths.dailyFile, '---\ntitle: "2026-04-10 Daily Log"\n---\n\n- Warm source detail.'],
      [warmPaths.warmFile, '---\ntitle: "2026-04-10 Warm Memory"\n---\n\nWarm summary detail.'],
      [warmPaths.coldFile, '---\ntitle: "2026-04-10 Cold Memory"\n---\n\nWarm stale cold detail.'],
      [coldPaths.dailyFile, '---\ntitle: "2026-03-01 Daily Log"\n---\n\n- Cold source detail.'],
      [coldPaths.warmFile, '---\ntitle: "2026-03-01 Warm Memory"\n---\n\nCold warm detail.'],
      [coldPaths.coldFile, '---\ntitle: "2026-03-01 Cold Memory"\n---\n\nCold summary detail.'],
      [orphanPaths.coldFile, '---\ntitle: "2026-03-05 Cold Memory"\n---\n\nOrphan cold detail.'],
    ]),
  );

  await syncAgentMemoryFromStore(database, {
    agentId: 'agent_flowagent_core',
    agentSlug: 'flowagent-core',
    fileStore,
    now: '2026-04-20T12:00:00.000Z',
  });

  const derivedRows = selectDerivedRows(database);
  assert.deepEqual(derivedRows, [
    [
      derivedRows[0]?.[0],
      '2026-03-01 Cold Memory',
      'Cold summary detail.',
      'daily',
      'cold_summary',
      '2026-03-01',
      '2026-03-01T23:59:59.999Z',
      '2026-03-01T23:59:59.999Z',
    ],
    [
      derivedRows[1]?.[0],
      '2026-04-10 Warm Memory',
      'Warm summary detail.',
      'daily',
      'warm_summary',
      '2026-04-10',
      '2026-04-10T23:59:59.999Z',
      '2026-04-10T23:59:59.999Z',
    ],
    [
      derivedRows[2]?.[0],
      '2026-04-19 Daily Log',
      '- Hot source detail.',
      'daily',
      'conversation_log',
      '2026-04-19',
      '2026-04-19T23:59:59.999Z',
      '2026-04-19T23:59:59.999Z',
    ],
  ]);

  database.close();
});

test('syncAgentMemoryFromStore migrates only intended legacy global and dated daily rows', async () => {
  const database = await createDatabase();

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
      'legacy_global',
      'agent_flowagent_core',
      'Preferences',
      'Remember project preferences.',
      'global',
      'manual',
      5,
      null,
      null,
      '2026-04-01T08:00:00.000Z',
      '2026-04-01T08:00:00.000Z',
    ],
  );
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
      'legacy_daily',
      'agent_flowagent_core',
      'Daily Notes',
      'Investigated migration path.',
      'daily',
      'conversation_log',
      3,
      null,
      '2026-04-01',
      '2026-04-01T08:30:00.000Z',
      '2026-04-01T08:30:00.000Z',
    ],
  );
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
      'session_note',
      'agent_flowagent_core',
      'Session Scratchpad',
      'Do not migrate this.',
      'session',
      'manual',
      2,
      null,
      null,
      '2026-04-01T08:45:00.000Z',
      '2026-04-01T08:45:00.000Z',
    ],
  );
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
      'undated_daily',
      'agent_flowagent_core',
      'Broken Daily',
      'Missing event date.',
      'daily',
      'conversation_log',
      2,
      null,
      null,
      '2026-04-01T08:50:00.000Z',
      '2026-04-01T08:50:00.000Z',
    ],
  );

  const fileStore = new InMemoryFileStore();

  const result = await syncAgentMemoryFromStore(database, {
    agentId: 'agent_flowagent_core',
    agentSlug: 'flowagent-core',
    fileStore,
    now: '2026-04-01T09:00:00.000Z',
  });

  const paths = buildAgentMemoryPaths('flowagent-core', '2026-04-01');
  const memoryMarkdown = await fileStore.readText(paths.memoryFile);
  const dailyMarkdown = await fileStore.readText(paths.dailyFile);
  const straySessionMarkdown = await fileStore.readText('memory/agents/flowagent-core/daily/session.md');

  assert.equal(result.migrated, true);
  assert.match(memoryMarkdown ?? '', /Remember project preferences\./);
  assert.match(dailyMarkdown ?? '', /Investigated migration path\./);
  assert.equal(straySessionMarkdown, null);
  assert.equal(fileStore.writes.length, 2);
  assert.deepEqual(fileStore.writes.sort(), [paths.dailyFile, paths.memoryFile].sort());
  const remainingIds = (
    database.exec(
      `
        SELECT id
        FROM agent_memory_documents
        WHERE agent_id = ?
        ORDER BY id ASC
      `,
      ['agent_flowagent_core'],
    )[0]?.values ?? []
  ).map((row) => String(row[0]));
  assert.equal(remainingIds.filter((id) => id.startsWith('memory_file_')).length, 2);
  assert.deepEqual(
    remainingIds.filter((id) => !id.startsWith('memory_file_')),
    ['session_note', 'undated_daily'],
  );

  database.close();
});

test('syncAgentMemoryFromStore deletes stale derived rows for removed markdown files', async () => {
  const database = await createDatabase();
  const paths = buildAgentMemoryPaths('flowagent-core', '2026-04-01');
  const fileStore = new InMemoryFileStore(
    new Map([
      [paths.memoryFile, '---\ntitle: "Working Preferences"\n---\n\nKeep answers terse.'],
      [paths.dailyFile, '---\ntitle: "2026-04-01 Daily Log"\n---\n\n- Investigated startup sync.'],
    ]),
  );

  await syncAgentMemoryFromStore(database, {
    agentId: 'agent_flowagent_core',
    agentSlug: 'flowagent-core',
    fileStore,
    now: '2026-04-01T09:00:00.000Z',
  });

  fileStore.writes = [];
  const removed = new Map([[paths.memoryFile, '---\ntitle: "Working Preferences"\n---\n\nKeep answers terse.']]);
  const prunedStore = new InMemoryFileStore(removed);

  const result = await syncAgentMemoryFromStore(database, {
    agentId: 'agent_flowagent_core',
    agentSlug: 'flowagent-core',
    fileStore: prunedStore,
    now: '2026-04-01T10:00:00.000Z',
  });

  assert.equal(result.changed, true);
  assert.deepEqual(selectDerivedRows(database), [
    [
      selectDerivedRows(database)[0]?.[0],
      'Working Preferences',
      'Keep answers terse.',
      'global',
      'manual',
      null,
      '2026-04-01T09:00:00.000Z',
      '2026-04-01T09:00:00.000Z',
    ],
  ]);

  database.close();
});

test('syncCurrentAgentMemory scopes workspace sync to the requested agent', async () => {
  const database = await createDatabase();
  database.run(
    `
      INSERT INTO agents (
        id,
        slug,
        name,
        description,
        system_prompt,
        provider_id,
        model,
        accent_color,
        workspace_relpath,
        is_default,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      'agent_writer',
      'writer',
      'Writer',
      'Second test agent',
      'System prompt',
      null,
      null,
      'from-amber-500/20 to-red-500/20',
      'agents/writer',
      0,
      '2026-04-01T00:00:00.000Z',
      '2026-04-01T00:00:00.000Z',
    ],
  );

  const fileStore = new InMemoryFileStore(
    new Map([
      ['memory/agents/flowagent-core/MEMORY.md', '---\ntitle: "Core"\n---\n\nCore memory.'],
      ['memory/agents/writer/MEMORY.md', '---\ntitle: "Writer"\n---\n\nWriter memory.'],
    ]),
  );
  setAgentMemoryFileStore(fileStore);

  const result = await syncCurrentAgentMemory({
    database,
    agentId: 'agent_writer',
  });

  const rows = database.exec(
    `
      SELECT agent_id, title, content
      FROM agent_memory_documents
      ORDER BY agent_id ASC, title ASC
    `,
  )[0]?.values;

  assert.equal(result?.changed, true);
  assert.deepEqual(rows, [['agent_writer', 'Writer', 'Writer memory.']]);

  setAgentMemoryFileStore(null);
  database.close();
});

test('getAgentMemoryContext only injects one effective document per date', async () => {
  const agentId = 'agent_runtime_precedence';
  await saveAgent({
    id: agentId,
    name: 'Runtime Precedence',
    description: 'Runtime precedence test agent',
    systemPrompt: 'System prompt',
    accentColor: 'from-emerald-500/20 to-teal-500/20',
    workspaceRelpath: 'agents/runtime-precedence',
  });

  const dayOne = buildAgentMemoryPaths('runtime-precedence', '2026-03-20');
  const dayTwo = buildAgentMemoryPaths('runtime-precedence', '2026-03-10');
  const dayThree = buildAgentMemoryPaths('runtime-precedence', '2026-03-31');
  setAgentMemoryFileStore(
    new InMemoryFileStore(
      new Map([
        ['memory/agents/runtime-precedence/MEMORY.md', '---\ntitle: "Prefs"\n---\n\nKeep context deduped.'],
        [dayOne.dailyFile, '---\ntitle: "2026-03-20 Daily Log"\n---\n\n- Warm raw detail that should not be injected.'],
        [dayOne.warmFile, '---\ntitle: "2026-03-20 Warm Memory"\n---\n\nWarm summary that should win.'],
        [dayOne.coldFile, '---\ntitle: "2026-03-20 Cold Memory"\n---\n\nCold summary that should lose to warm.'],
        [dayTwo.dailyFile, '---\ntitle: "2026-03-10 Daily Log"\n---\n\n- Cold raw detail that should not be injected.'],
        [dayTwo.warmFile, '---\ntitle: "2026-03-10 Warm Memory"\n---\n\nCold warm summary that should lose to cold.'],
        [dayTwo.coldFile, '---\ntitle: "2026-03-10 Cold Memory"\n---\n\nCold summary that should win.'],
        [dayThree.dailyFile, '---\ntitle: "2026-03-31 Daily Log"\n---\n\n- Only source document for this hot day.'],
        [dayThree.warmFile, '---\ntitle: "2026-03-31 Warm Memory"\n---\n\nHot warm summary that should lose to source.'],
        [dayThree.coldFile, '---\ntitle: "2026-03-31 Cold Memory"\n---\n\nHot cold summary that should lose to source.'],
      ]),
    ),
  );

  const context = await getAgentMemoryContext(agentId, {
    includeRecentMemorySnapshot: true,
    now: '2026-04-01T12:00:00.000Z',
  });

  assert.match(context, /Cold memory:\n- 2026-03-10 Cold Memory: Cold summary that should win\./);
  assert.match(context, /Warm memory:\n- 2026-03-20 Warm Memory: Warm summary that should win\./);
  assert.match(context, /Hot memory:\n- 2026-03-31 Daily Log: - Only source document for this hot day\./);
  assert.doesNotMatch(context, /Recent memory snapshot:\n- 2026-03-10 Cold Memory:/);
  assert.doesNotMatch(context, /2026-03-10 Daily Log: Cold raw detail that should not be injected\./);
  assert.doesNotMatch(context, /2026-03-20 Daily Log: Warm raw detail that should not be injected\./);
  assert.doesNotMatch(context, /2026-03-31 Warm Memory: Hot warm summary that should lose to source\./);
  assert.doesNotMatch(context, /2026-03-31 Cold Memory: Hot cold summary that should lose to source\./);
  assert.equal((context.match(/2026-03-10 /g) ?? []).length, 1);
  assert.equal((context.match(/2026-03-20 /g) ?? []).length, 2);
  assert.equal((context.match(/2026-03-31 /g) ?? []).length, 2);

  setAgentMemoryFileStore(null);
});

test('bootstrap corrections and reflections are read separately from routed memory context', async () => {
  const agentId = 'agent_bootstrap_memory';
  await saveAgent({
    id: agentId,
    name: 'Bootstrap Memory',
    description: 'Bootstrap memory test agent',
    systemPrompt: 'System prompt',
    accentColor: 'from-emerald-500/20 to-teal-500/20',
    workspaceRelpath: 'agents/bootstrap-memory',
  });

  const paths = buildAgentMemoryPaths('bootstrap-memory', '2026-04-01');
  setAgentMemoryFileStore(
    new InMemoryFileStore(
      new Map([
        [paths.memoryFile, '---\ntitle: "Prefs"\n---\n\nKeep answers compact.'],
        [paths.correctionsFile, '---\ntitle: "Corrections"\n---\n\n- Rule: 不要把 todo-list.md 纳入 git。'],
        [paths.reflectionsFile, '---\ntitle: "Reflections"\n---\n\n- Lesson: 配置变更要检查 desktop。'],
      ]),
    ),
  );

  const bootstrapContext = await getAgentBootstrapMemoryContext(agentId);
  const routedContext = await getAgentMemoryContext(agentId, {
    includeRecentMemorySnapshot: true,
    now: '2026-04-01T12:00:00.000Z',
  });

  assert.match(bootstrapContext.corrections, /不要把 todo-list\.md 纳入 git/);
  assert.match(bootstrapContext.reflections, /配置变更要检查 desktop/);
  assert.match(routedContext, /Long-term memory:\n- Prefs: Keep answers compact\./);
  assert.doesNotMatch(routedContext, /不要把 todo-list\.md 纳入 git/);
  assert.doesNotMatch(routedContext, /配置变更要检查 desktop/);

  setAgentMemoryFileStore(null);
});

test('getAgentMemoryContext routes explicit old dates to cold plus global only', async () => {
  const agentId = 'agent_query_router_explicit_cold';
  const workspaceRelpath = 'agents/query-router-explicit-cold';
  const slug = 'query-router-explicit-cold';
  const now = '2026-04-01T12:00:00.000Z';
  const hotPaths = buildAgentMemoryPaths(slug, '2026-03-31');
  const warmPaths = buildAgentMemoryPaths(slug, '2026-03-20');
  const coldPaths = buildAgentMemoryPaths(slug, '2026-03-01');

  await setupMemoryContextAgent(
    agentId,
    workspaceRelpath,
    new Map([
      [buildAgentMemoryPaths(slug, '2026-04-01').memoryFile, '---\ntitle: "Global Memory"\n---\n\nGlobal preference.'],
      [hotPaths.dailyFile, '---\ntitle: "2026-03-31 Daily Log"\n---\n\n- Hot detail that should not be injected.'],
      [warmPaths.dailyFile, '---\ntitle: "2026-03-20 Daily Log"\n---\n\n- Warm detail that should not be injected.'],
      [coldPaths.dailyFile, '---\ntitle: "2026-03-01 Daily Log"\n---\n\n- Cold detail that should be injected.'],
    ]),
  );

  try {
    const context = await getAgentMemoryContext(agentId, {
      includeRecentMemorySnapshot: false,
      now,
      query: '2026-03-01 那天发生了什么？',
    });

    assert.match(context, /Long-term memory:\n- Global Memory: Global preference\./);
    assert.match(context, /Cold memory:\n- 2026-03-01 Daily Log: - Cold detail that should be injected\./);
    assert.doesNotMatch(context, /Hot memory:/);
    assert.doesNotMatch(context, /Warm memory:/);
  } finally {
    setAgentMemoryFileStore(null);
  }
});

test('searchMemories exposes routed layers and stages for explicit cold queries', async () => {
  const agentId = 'agent_search_memories_explicit_cold';
  const workspaceRelpath = 'agents/search-memories-explicit-cold';
  const slug = 'search-memories-explicit-cold';
  const now = '2026-04-01T12:00:00.000Z';
  const hotPaths = buildAgentMemoryPaths(slug, '2026-03-31');
  const coldPaths = buildAgentMemoryPaths(slug, '2026-03-01');

  await setupMemoryContextAgent(
    agentId,
    workspaceRelpath,
    new Map([
      [buildAgentMemoryPaths(slug, '2026-04-01').memoryFile, '---\ntitle: "Global Memory"\n---\n\nGlobal preference.'],
      [hotPaths.dailyFile, '---\ntitle: "2026-03-31 Daily Log"\n---\n\n- Hot detail that should stay out.'],
      [coldPaths.dailyFile, '---\ntitle: "2026-03-01 Daily Log"\n---\n\n- Cold routed detail.'],
    ]),
  );

  try {
    const results = await searchMemories(agentId, {
      now,
      query: '2026-03-01 那天发生了什么？',
    });

    assert.deepEqual(
      results
        .map((result) => [result.title, result.layer, result.retrievalStage])
        .sort(([left], [right]) => String(left).localeCompare(String(right))),
      [
        ['2026-03-01 Daily Log', 'cold', 'preferred'],
        ['Global Memory', 'global', 'preferred'],
      ],
    );
  } finally {
    setAgentMemoryFileStore(null);
  }
});

test('getAgentMemoryContext adds cold fallback when default routing has fewer than two non-global documents', async () => {
  const agentId = 'agent_query_router_default_fallback';
  const workspaceRelpath = 'agents/query-router-default-fallback';
  const slug = 'query-router-default-fallback';
  const now = '2026-04-01T12:00:00.000Z';
  const hotPaths = buildAgentMemoryPaths(slug, '2026-03-31');
  const coldPaths = buildAgentMemoryPaths(slug, '2026-03-01');

  await setupMemoryContextAgent(
    agentId,
    workspaceRelpath,
    new Map([
      [buildAgentMemoryPaths(slug, '2026-04-01').memoryFile, '---\ntitle: "Global Memory"\n---\n\nGlobal preference.'],
      [hotPaths.dailyFile, '---\ntitle: "2026-03-31 Daily Log"\n---\n\n- Hot detail.'],
      [coldPaths.dailyFile, '---\ntitle: "2026-03-01 Daily Log"\n---\n\n- Cold fallback detail.'],
    ]),
  );

  try {
    const context = await getAgentMemoryContext(agentId, {
      includeRecentMemorySnapshot: false,
      now,
      query: '这个方案还有哪些记忆？',
    });

    assert.match(context, /Long-term memory:\n- Global Memory: Global preference\./);
    assert.match(context, /Hot memory:\n- 2026-03-31 Daily Log: - Hot detail\./);
    assert.match(context, /Cold memory:\n- 2026-03-01 Daily Log: - Cold fallback detail\./);
  } finally {
    setAgentMemoryFileStore(null);
  }
});

test('getAgentMemoryContext does not add cold fallback when default routing already has two non-global documents', async () => {
  const agentId = 'agent_query_router_default_no_fallback';
  const workspaceRelpath = 'agents/query-router-default-no-fallback';
  const slug = 'query-router-default-no-fallback';
  const now = '2026-04-01T12:00:00.000Z';
  const hotPaths = buildAgentMemoryPaths(slug, '2026-03-31');
  const warmPaths = buildAgentMemoryPaths(slug, '2026-03-20');
  const coldPaths = buildAgentMemoryPaths(slug, '2026-03-01');

  await setupMemoryContextAgent(
    agentId,
    workspaceRelpath,
    new Map([
      [buildAgentMemoryPaths(slug, '2026-04-01').memoryFile, '---\ntitle: "Global Memory"\n---\n\nGlobal preference.'],
      [hotPaths.dailyFile, '---\ntitle: "2026-03-31 Daily Log"\n---\n\n- Hot detail.'],
      [warmPaths.dailyFile, '---\ntitle: "2026-03-20 Daily Log"\n---\n\n- Warm detail.'],
      [coldPaths.dailyFile, '---\ntitle: "2026-03-01 Daily Log"\n---\n\n- Cold detail that should stay hidden.'],
    ]),
  );

  try {
    const context = await getAgentMemoryContext(agentId, {
      includeRecentMemorySnapshot: false,
      now,
      query: '这个方案还有哪些记忆？',
    });

    assert.match(context, /Hot memory:\n- 2026-03-31 Daily Log: - Hot detail\./);
    assert.match(context, /Warm memory:\n- 2026-03-20 Daily Log: - Warm detail\./);
    assert.doesNotMatch(context, /Cold memory:\n- 2026-03-01 Daily Log: - Cold detail that should stay hidden\./);
  } finally {
    setAgentMemoryFileStore(null);
  }
});

test('syncAgentMemoryFromStore upserts cold memory embeddings when embedding config is available', async () => {
  const restoreFetch = installEmbeddingFetchMock([{ match: 'Cold source detail.', embedding: [0.2, 0.4, 0.8] }]);

  const database = await createDatabase();
  const coldPaths = buildAgentMemoryPaths('flowagent-core', '2026-03-01');
  const fileStore = new InMemoryFileStore(
    new Map([
      [coldPaths.dailyFile, '---\ntitle: "2026-03-01 Daily Log"\n---\n\n- Cold source detail.\n- TODO archive it.'],
      [coldPaths.coldFile, '---\ntitle: "2026-03-01 Cold Memory"\n---\n\n## Summary\nCold source detail.\n\n## Keywords\n- archive'],
    ]),
  );

  try {
    await syncAgentMemoryFromStore(database, {
      agentId: 'agent_flowagent_core',
      agentSlug: 'flowagent-core',
      fileStore,
      now: '2026-04-20T12:00:00.000Z',
      embeddingConfig: TEST_EMBEDDING_CONFIG,
    });

    const rows = selectColdEmbeddingRows(database);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.[1], 'agent_flowagent_core');
    assert.equal(rows[0]?.[2], '2026-03-01');
    assert.equal(rows[0]?.[3], 'cold_summary');
    assert.equal(rows[0]?.[4], 'test-embedding');
    assert.equal(rows[0]?.[5], 3);
    assert.match(String(rows[0]?.[7] ?? ''), /Cold source detail\./);
  } finally {
    restoreFetch();
    database.close();
  }
});

test('syncAgentMemoryFromStore deletes stale cold embeddings when cold surrogate disappears', async () => {
  const restoreFetch = installEmbeddingFetchMock([{ match: 'Cold source detail.', embedding: [0.1, 0.3, 0.9] }]);

  const database = await createDatabase();
  const coldPaths = buildAgentMemoryPaths('flowagent-core', '2026-03-01');
  const fullStore = new InMemoryFileStore(
    new Map([
      [coldPaths.dailyFile, '---\ntitle: "2026-03-01 Daily Log"\n---\n\n- Cold source detail.'],
      [coldPaths.coldFile, '---\ntitle: "2026-03-01 Cold Memory"\n---\n\n## Summary\nCold source detail.\n\n## Keywords\n- archive'],
    ]),
  );

  try {
    await syncAgentMemoryFromStore(database, {
      agentId: 'agent_flowagent_core',
      agentSlug: 'flowagent-core',
      fileStore: fullStore,
      now: '2026-04-20T12:00:00.000Z',
      embeddingConfig: TEST_EMBEDDING_CONFIG,
    });

    const sourceOnlyStore = new InMemoryFileStore(
      new Map([[coldPaths.dailyFile, '---\ntitle: "2026-03-01 Daily Log"\n---\n\n- Cold source detail.']]),
    );

    await syncAgentMemoryFromStore(database, {
      agentId: 'agent_flowagent_core',
      agentSlug: 'flowagent-core',
      fileStore: sourceOnlyStore,
      now: '2026-04-05T12:00:00.000Z',
      embeddingConfig: TEST_EMBEDDING_CONFIG,
    });

    assert.equal(selectColdEmbeddingRows(database).length, 0);
  } finally {
    restoreFetch();
    database.close();
  }
});

test('syncAgentMemoryFromStore skips cold vector sync when embedding config is unavailable', async () => {
  const database = await createDatabase();
  const coldPaths = buildAgentMemoryPaths('flowagent-core', '2026-03-01');
  const fileStore = new InMemoryFileStore(
    new Map([
      [coldPaths.dailyFile, '---\ntitle: "2026-03-01 Daily Log"\n---\n\n- Cold source detail.'],
      [coldPaths.coldFile, '---\ntitle: "2026-03-01 Cold Memory"\n---\n\n## Summary\nCold source detail.\n\n## Keywords\n- archive'],
    ]),
  );

  await syncAgentMemoryFromStore(database, {
    agentId: 'agent_flowagent_core',
    agentSlug: 'flowagent-core',
    fileStore,
    now: '2026-04-20T12:00:00.000Z',
    embeddingConfig: null,
  });

  assert.equal(selectColdEmbeddingRows(database).length, 0);
  database.close();
});

test('getAgentMemoryContext uses cold vector retrieval for explicit_cold queries', async () => {
  const restoreFetch = installEmbeddingFetchMock([
    { match: 'Alpha cold detail.', embedding: [1, 0, 0] },
    { match: 'Beta cold detail.', embedding: [0, 1, 0] },
    { match: 'Beta 方案', embedding: [0, 1, 0] },
  ]);

  const agentId = 'agent_cold_vector_explicit';
  const slug = 'cold-vector-explicit';
  const dayOne = buildAgentMemoryPaths(slug, '2026-03-01');
  const dayTwo = buildAgentMemoryPaths(slug, '2026-03-02');
  await setupMemoryContextAgent(
    agentId,
    `agents/${slug}`,
    new Map([
      ['memory/agents/cold-vector-explicit/MEMORY.md', '---\ntitle: "Global Memory"\n---\n\nGlobal preference.'],
      [dayOne.dailyFile, '---\ntitle: "2026-03-01 Daily Log"\n---\n\n- Alpha cold detail.'],
      [dayOne.coldFile, '---\ntitle: "2026-03-01 Cold Memory"\n---\n\n## Summary\nAlpha cold detail.\n\n## Keywords\n- alpha'],
      [dayTwo.dailyFile, '---\ntitle: "2026-03-02 Daily Log"\n---\n\n- Beta cold detail.'],
      [dayTwo.coldFile, '---\ntitle: "2026-03-02 Cold Memory"\n---\n\n## Summary\nBeta cold detail.\n\n## Keywords\n- beta'],
    ]),
  );

  try {
    const database = await initDB();
    await syncAgentMemoryFromStore(database, {
      agentId,
      agentSlug: slug,
      fileStore: new InMemoryFileStore(
        new Map([
          ['memory/agents/cold-vector-explicit/MEMORY.md', '---\ntitle: "Global Memory"\n---\n\nGlobal preference.'],
          [dayOne.dailyFile, '---\ntitle: "2026-03-01 Daily Log"\n---\n\n- Alpha cold detail.'],
          [dayOne.coldFile, '---\ntitle: "2026-03-01 Cold Memory"\n---\n\n## Summary\nAlpha cold detail.\n\n## Keywords\n- alpha'],
          [dayTwo.dailyFile, '---\ntitle: "2026-03-02 Daily Log"\n---\n\n- Beta cold detail.'],
          [dayTwo.coldFile, '---\ntitle: "2026-03-02 Cold Memory"\n---\n\n## Summary\nBeta cold detail.\n\n## Keywords\n- beta'],
        ]),
      ),
      now: '2026-04-20T12:00:00.000Z',
      embeddingConfig: TEST_EMBEDDING_CONFIG,
    });

    const context = await getAgentMemoryContext(agentId, {
      includeRecentMemorySnapshot: false,
      now: '2026-04-20T12:00:00.000Z',
      query: '2026-03-02 那天的 Beta 方案是什么？',
      embeddingConfig: TEST_EMBEDDING_CONFIG,
    });

    assert.match(context, /Long-term memory:\n- Global Memory: Global preference\./);
    assert.match(context, /Cold memory:\n- 2026-03-02 Cold Memory: ## Summary Beta cold detail\. ## Keywords - beta/);
    assert.doesNotMatch(context, /2026-03-01 Cold Memory: Alpha cold detail\./);
  } finally {
    restoreFetch();
    setAgentMemoryFileStore(null);
  }
});

test('getAgentMemoryContext uses cold vector fallback only when recent layers are insufficient', async () => {
  const restoreFetch = installEmbeddingFetchMock([
    { match: 'Old launch note.', embedding: [1, 0, 0] },
    { match: 'Old migration note.', embedding: [0, 1, 0] },
    { match: 'migration note', embedding: [0, 1, 0] },
  ]);

  const agentId = 'agent_cold_vector_default';
  const slug = 'cold-vector-default';
  const hot = buildAgentMemoryPaths(slug, '2026-04-19');
  const warm = buildAgentMemoryPaths(slug, '2026-04-01');
  const coldA = buildAgentMemoryPaths(slug, '2026-03-01');
  const coldB = buildAgentMemoryPaths(slug, '2026-03-02');
  await setupMemoryContextAgent(
    agentId,
    `agents/${slug}`,
    new Map([
      [hot.dailyFile, '---\ntitle: "2026-04-19 Daily Log"\n---\n\n- Fresh hot detail.'],
      [warm.dailyFile, '---\ntitle: "2026-04-01 Daily Log"\n---\n\n- Warm bridge detail.'],
      [coldA.dailyFile, '---\ntitle: "2026-03-01 Daily Log"\n---\n\n- Old launch note.'],
      [coldA.coldFile, '---\ntitle: "2026-03-01 Cold Memory"\n---\n\n## Summary\nOld launch note.\n\n## Keywords\n- launch'],
      [coldB.dailyFile, '---\ntitle: "2026-03-02 Daily Log"\n---\n\n- Old migration note.'],
      [coldB.coldFile, '---\ntitle: "2026-03-02 Cold Memory"\n---\n\n## Summary\nOld migration note.\n\n## Keywords\n- migration'],
    ]),
  );

  try {
    const database = await initDB();
    await syncAgentMemoryFromStore(database, {
      agentId,
      agentSlug: slug,
      fileStore: new InMemoryFileStore(
        new Map([
          [hot.dailyFile, '---\ntitle: "2026-04-19 Daily Log"\n---\n\n- Fresh hot detail.'],
          [warm.dailyFile, '---\ntitle: "2026-04-01 Daily Log"\n---\n\n- Warm bridge detail.'],
          [coldA.dailyFile, '---\ntitle: "2026-03-01 Daily Log"\n---\n\n- Old launch note.'],
          [coldA.coldFile, '---\ntitle: "2026-03-01 Cold Memory"\n---\n\n## Summary\nOld launch note.\n\n## Keywords\n- launch'],
          [coldB.dailyFile, '---\ntitle: "2026-03-02 Daily Log"\n---\n\n- Old migration note.'],
          [coldB.coldFile, '---\ntitle: "2026-03-02 Cold Memory"\n---\n\n## Summary\nOld migration note.\n\n## Keywords\n- migration'],
        ]),
      ),
      now: '2026-04-20T12:00:00.000Z',
      embeddingConfig: TEST_EMBEDDING_CONFIG,
    });

    const fallbackContext = await getAgentMemoryContext(agentId, {
      includeRecentMemorySnapshot: false,
      now: '2026-04-20T12:00:00.000Z',
      query: '这个 migration note 还有什么背景？',
      embeddingConfig: TEST_EMBEDDING_CONFIG,
    });

    assert.match(fallbackContext, /Hot memory:\n- 2026-04-19 Daily Log: - Fresh hot detail\./);
    assert.match(
      fallbackContext,
      /Cold memory:\n- 2026-03-02 Cold Memory: ## Summary Old migration note\. ## Keywords - migration/,
    );
    assert.doesNotMatch(fallbackContext, /2026-03-01 Cold Memory: Old launch note\./);

    const noFallbackContext = await getAgentMemoryContext(agentId, {
      includeRecentMemorySnapshot: false,
      now: '2026-04-14T12:00:00.000Z',
      query: '这个 migration note 还有什么背景？',
      embeddingConfig: TEST_EMBEDDING_CONFIG,
    });

    assert.match(noFallbackContext, /Warm memory:\n- 2026-04-01 Daily Log: - Warm bridge detail\./);
    assert.doesNotMatch(noFallbackContext, /Cold memory:\n- 2026-03-02 Cold Memory: Old migration note\./);
  } finally {
    restoreFetch();
    setAgentMemoryFileStore(null);
  }
});

test('getAgentMemoryContext skips cold vector retrieval safely when embedding config is missing', async () => {
  const agentId = 'agent_cold_vector_missing_config';
  const slug = 'cold-vector-missing-config';
  const cold = buildAgentMemoryPaths(slug, '2026-03-01');
  await setupMemoryContextAgent(
    agentId,
    `agents/${slug}`,
    new Map([
      [cold.dailyFile, '---\ntitle: "2026-03-01 Daily Log"\n---\n\n- Cold fallback detail.'],
      [cold.coldFile, '---\ntitle: "2026-03-01 Cold Memory"\n---\n\n## Summary\nCold fallback detail.\n\n## Keywords\n- fallback'],
    ]),
  );

  try {
    const database = await initDB();
    await syncAgentMemoryFromStore(database, {
      agentId,
      agentSlug: slug,
      fileStore: new InMemoryFileStore(
        new Map([
          [cold.dailyFile, '---\ntitle: "2026-03-01 Daily Log"\n---\n\n- Cold fallback detail.'],
          [cold.coldFile, '---\ntitle: "2026-03-01 Cold Memory"\n---\n\n## Summary\nCold fallback detail.\n\n## Keywords\n- fallback'],
        ]),
      ),
      now: '2026-04-20T12:00:00.000Z',
      embeddingConfig: null,
    });

    const context = await getAgentMemoryContext(agentId, {
      includeRecentMemorySnapshot: false,
      now: '2026-04-20T12:00:00.000Z',
      query: '2026-03-01 那天发生了什么？',
      embeddingConfig: null,
    });

    assert.match(
      context,
      /Cold memory:\n- 2026-03-01 Cold Memory: ## Summary Cold fallback detail\. ## Keywords - fallback/,
    );
  } finally {
    setAgentMemoryFileStore(null);
  }
});

test('getAgentMemoryContext keeps explicit_cold routing constrained to cold and global when vector search misses', async () => {
  const restoreFetch = installEmbeddingFetchMock([
    { match: 'Alpha cold detail.', embedding: [1, 0, 0] },
    { match: 'Beta cold detail.', embedding: [0, 1, 0] },
    { match: '2026-03-02 那天的 Gamma 方案是什么？', embedding: [0, 0, 1] },
  ]);

  const agentId = 'agent_cold_vector_miss';
  const slug = 'cold-vector-miss';
  const hot = buildAgentMemoryPaths(slug, '2026-04-19');
  const warm = buildAgentMemoryPaths(slug, '2026-04-10');
  const coldA = buildAgentMemoryPaths(slug, '2026-03-01');
  const coldB = buildAgentMemoryPaths(slug, '2026-03-02');
  await setupMemoryContextAgent(
    agentId,
    `agents/${slug}`,
    new Map([
      ['memory/agents/cold-vector-miss/MEMORY.md', '---\ntitle: "Global Memory"\n---\n\nGlobal preference.'],
      [hot.dailyFile, '---\ntitle: "2026-04-19 Daily Log"\n---\n\n- Fresh hot detail.'],
      [warm.dailyFile, '---\ntitle: "2026-04-10 Daily Log"\n---\n\n- Warm bridge detail.'],
      [coldA.dailyFile, '---\ntitle: "2026-03-01 Daily Log"\n---\n\n- Alpha cold detail.'],
      [coldA.coldFile, '---\ntitle: "2026-03-01 Cold Memory"\n---\n\n## Summary\nAlpha cold detail.\n\n## Keywords\n- alpha'],
      [coldB.dailyFile, '---\ntitle: "2026-03-02 Daily Log"\n---\n\n- Beta cold detail.'],
      [coldB.coldFile, '---\ntitle: "2026-03-02 Cold Memory"\n---\n\n## Summary\nBeta cold detail.\n\n## Keywords\n- beta'],
    ]),
  );

  try {
    const database = await initDB();
    await syncAgentMemoryFromStore(database, {
      agentId,
      agentSlug: slug,
      fileStore: new InMemoryFileStore(
        new Map([
          ['memory/agents/cold-vector-miss/MEMORY.md', '---\ntitle: "Global Memory"\n---\n\nGlobal preference.'],
          [hot.dailyFile, '---\ntitle: "2026-04-19 Daily Log"\n---\n\n- Fresh hot detail.'],
          [warm.dailyFile, '---\ntitle: "2026-04-10 Daily Log"\n---\n\n- Warm bridge detail.'],
          [coldA.dailyFile, '---\ntitle: "2026-03-01 Daily Log"\n---\n\n- Alpha cold detail.'],
          [coldA.coldFile, '---\ntitle: "2026-03-01 Cold Memory"\n---\n\n## Summary\nAlpha cold detail.\n\n## Keywords\n- alpha'],
          [coldB.dailyFile, '---\ntitle: "2026-03-02 Daily Log"\n---\n\n- Beta cold detail.'],
          [coldB.coldFile, '---\ntitle: "2026-03-02 Cold Memory"\n---\n\n## Summary\nBeta cold detail.\n\n## Keywords\n- beta'],
        ]),
      ),
      now: '2026-04-20T12:00:00.000Z',
      embeddingConfig: TEST_EMBEDDING_CONFIG,
    });

    const context = await getAgentMemoryContext(agentId, {
      includeRecentMemorySnapshot: false,
      now: '2026-04-20T12:00:00.000Z',
      query: '2026-03-02 那天的 Gamma 方案是什么？',
      embeddingConfig: TEST_EMBEDDING_CONFIG,
    });

    assert.match(context, /Long-term memory:\n- Global Memory: Global preference\./);
    assert.match(context, /Cold memory:\n-/);
    assert.match(context, /2026-03-01 Cold Memory: ## Summary Alpha cold detail\. ## Keywords - alpha/);
    assert.match(context, /2026-03-02 Cold Memory: ## Summary Beta cold detail\. ## Keywords - beta/);
    assert.doesNotMatch(context, /Hot memory:\n- 2026-04-19 Daily Log: - Fresh hot detail\./);
    assert.doesNotMatch(context, /Warm memory:\n- 2026-04-10 Daily Log: - Warm bridge detail\./);
  } finally {
    restoreFetch();
    setAgentMemoryFileStore(null);
  }
});
