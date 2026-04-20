import assert from 'node:assert/strict';
import test from 'node:test';

import { DatabaseTransactionError, runDatabaseTransaction } from '../src/lib/db-transaction';

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

test('runDatabaseTransaction preserves the original failure when rollback also fails', async () => {
  const queries: string[] = [];
  const originalFailure = new Error('write failed');

  await assert.rejects(
    () =>
      runDatabaseTransaction(
        {
          run(query: string) {
            queries.push(query);
            if (query === 'ROLLBACK') {
              throw new Error('rollback failed');
            }
          },
        },
        () => {
          throw originalFailure;
        },
      ),
    (error) => {
      assert.ok(error instanceof DatabaseTransactionError);
      assert.equal(error.cause, originalFailure);
      assert.match(String((error as any).rollbackError?.message), /rollback failed/);
      return true;
    },
  );
  assert.deepEqual(queries, ['BEGIN', 'ROLLBACK']);
});
