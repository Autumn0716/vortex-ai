import assert from 'node:assert/strict';
import test from 'node:test';

import { runDatabaseTransaction } from '../src/lib/db-transaction';

function createFakeDatabase() {
  const queries: string[] = [];
  return {
    queries,
    database: {
      run(query: string) {
        queries.push(query);
      },
    },
  };
}

test('runDatabaseTransaction commits successful callbacks', async () => {
  const fake = createFakeDatabase();
  const result = await runDatabaseTransaction(fake.database, () => 'ok');

  assert.equal(result, 'ok');
  assert.deepEqual(fake.queries, ['BEGIN', 'COMMIT']);
});

test('runDatabaseTransaction rolls back and rethrows callback failures', async () => {
  const fake = createFakeDatabase();

  await assert.rejects(
    () =>
      runDatabaseTransaction(fake.database, () => {
        throw new Error('failed write');
      }),
    /failed write/,
  );
  assert.deepEqual(fake.queries, ['BEGIN', 'ROLLBACK']);
});
