import assert from 'node:assert/strict';
import test from 'node:test';

import { err, isErr, isOk, ok, type Result } from '../src/lib/result';

test('ok creates a success result', () => {
  const result = ok({ id: 'value' });

  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { id: 'value' });
  assert.equal(isOk(result), true);
  assert.equal(isErr(result), false);
});

test('err creates a failure result', () => {
  const failure = new Error('failed');
  const result: Result<string> = err(failure);

  assert.equal(result.ok, false);
  assert.equal(result.error, failure);
  assert.equal(isOk(result), false);
  assert.equal(isErr(result), true);
});
