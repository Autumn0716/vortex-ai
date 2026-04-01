import test from 'node:test';
import assert from 'node:assert/strict';

import { formatErrorDetails, wrapErrorWithContext } from '../src/lib/error-details';

test('formatErrorDetails includes nested cause chains for errors', () => {
  const error = wrapErrorWithContext(
    'Opening local workspace failed',
    wrapErrorWithContext('Loading SQLite database failed', new Error('QuotaExceededError')),
  );

  const details = formatErrorDetails(error);

  assert.match(details, /Opening local workspace failed/);
  assert.match(details, /Loading SQLite database failed/);
  assert.match(details, /QuotaExceededError/);
});

test('formatErrorDetails handles non-error values', () => {
  const details = formatErrorDetails({ code: 'E_BOOTSTRAP', step: 'hydrateTopic' });

  assert.match(details, /Non-Error value thrown/);
  assert.match(details, /E_BOOTSTRAP/);
  assert.match(details, /hydrateTopic/);
});
