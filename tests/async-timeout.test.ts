import test from 'node:test';
import assert from 'node:assert/strict';

import { TimeoutError, withSoftTimeout } from '../src/lib/async-timeout';

test('withSoftTimeout resolves a slow promise after the soft timeout notice fires', async () => {
  let softTimeoutCount = 0;

  const result = await withSoftTimeout(
    new Promise<string>((resolve) => {
      setTimeout(() => resolve('ready'), 25);
    }),
    {
      softTimeoutMs: 5,
      hardTimeoutMs: 100,
      onSoftTimeout: () => {
        softTimeoutCount += 1;
      },
      hardTimeoutMessage: 'bootstrap timed out',
    },
  );

  assert.equal(result, 'ready');
  assert.equal(softTimeoutCount, 1);
});

test('withSoftTimeout rejects with TimeoutError when the hard timeout expires', async () => {
  let softTimeoutCount = 0;

  await assert.rejects(
    withSoftTimeout(new Promise<never>(() => undefined), {
      softTimeoutMs: 5,
      hardTimeoutMs: 20,
      onSoftTimeout: () => {
        softTimeoutCount += 1;
      },
      hardTimeoutMessage: 'workspace timed out',
    }),
    (error: unknown) => {
      assert.ok(error instanceof TimeoutError);
      assert.equal(error.message, 'workspace timed out');
      return true;
    },
  );

  assert.equal(softTimeoutCount, 1);
});
