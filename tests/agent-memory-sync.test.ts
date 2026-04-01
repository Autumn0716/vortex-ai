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
import { getAgentMemoryContext, saveAgent, syncCurrentAgentMemory } from '../src/lib/agent-workspace';
import { Database } from '../src/lib/db';

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
