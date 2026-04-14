import assert from 'node:assert/strict';
import test from 'node:test';

import { createFts5Table, createFts5Tables, hasFts5Table } from '../src/lib/db-fts5-helpers';

function createFakeDatabase(options?: { failRun?: boolean; tableExists?: boolean }) {
  const runQueries: string[] = [];
  const execCalls: Array<{ query: string; params?: unknown[] }> = [];
  return {
    runQueries,
    execCalls,
    database: {
      run(query: string) {
        if (options?.failRun) {
          throw new Error('fts unavailable');
        }
        runQueries.push(query);
      },
      exec(query: string, params?: unknown[]) {
        execCalls.push({ query, params });
        return options?.tableExists ? [{ values: [['document_chunks_fts']] }] : [{ values: [] }];
      },
    },
  };
}

test('createFts5Table creates a virtual table from centralized schema metadata', () => {
  const fake = createFakeDatabase();
  const created = createFts5Table(fake.database, {
    tableName: 'document_chunks_fts',
    columns: ['chunk_id UNINDEXED', 'document_id UNINDEXED', 'title', 'content'],
  });

  assert.equal(created, true);
  assert.equal(fake.runQueries.length, 1);
  assert.match(fake.runQueries[0], /CREATE VIRTUAL TABLE IF NOT EXISTS document_chunks_fts USING fts5/);
  assert.match(fake.runQueries[0], /chunk_id UNINDEXED/);
  assert.match(fake.runQueries[0], /content/);
});

test('createFts5Tables returns false when any table cannot be created', () => {
  const fake = createFakeDatabase({ failRun: true });
  const errors: unknown[] = [];
  const created = createFts5Tables(
    fake.database,
    [{ tableName: 'topic_title_fts', columns: ['topic_id UNINDEXED', 'title'] }],
    { onError: (error) => errors.push(error) },
  );

  assert.equal(created, false);
  assert.equal(errors.length, 1);
});

test('hasFts5Table checks sqlite_master without interpolating lookup values', () => {
  const fake = createFakeDatabase({ tableExists: true });

  assert.equal(hasFts5Table(fake.database, 'document_chunks_fts'), true);
  assert.equal(fake.execCalls.length, 1);
  assert.deepEqual(fake.execCalls[0].params, ['document_chunks_fts']);
});

test('FTS5 helpers reject unsafe identifiers', () => {
  const fake = createFakeDatabase();

  assert.throws(
    () => createFts5Table(fake.database, { tableName: 'bad-name', columns: ['content'] }),
    /Invalid FTS5 identifier/,
  );
  assert.throws(() => hasFts5Table(fake.database, 'bad-name'), /Invalid FTS5 identifier/);
});
