import assert from 'node:assert/strict';
import test from 'node:test';

import initSqlite from '@sqlite.org/sqlite-wasm';

import {
  setAgentMemoryFileStore,
  syncAgentMemoryFromStore,
  type AgentMemoryFileStore,
} from '../src/lib/agent-memory-sync';
import { ensureAgentWorkspaceSchema } from '../src/lib/agent-workspace-schema';
import { buildAgentMemoryPaths } from '../src/lib/agent-memory-files';
import { syncCurrentAgentMemory } from '../src/lib/agent-workspace';
import { Database } from '../src/lib/db';

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
      '2026-04-01T09:00:00.000Z',
      '2026-04-01T09:00:00.000Z',
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
      '2026-04-01T09:00:00.000Z',
      '2026-04-01T10:00:00.000Z',
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
