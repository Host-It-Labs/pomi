import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchWithRetry } from './http-client.mjs';

function networkFailure() {
  return new Error('fetch failed', {
    cause: {
      code: 'ENOTFOUND',
      message: 'getaddrinfo ENOTFOUND api.github.com',
    },
  });
}

test('retries safe reads and reports the endpoint and network cause', async () => {
  let attempts = 0;
  await assert.rejects(
    fetchWithRetry(
      new URL('https://api.github.com/repos/Host-It-Labs/pomi'),
      {},
      async () => {
        attempts += 1;
        throw networkFailure();
      },
      [0, 0, 0]
    ),
    error => {
      assert.equal(attempts, 3);
      assert.match(
        error.message,
        /GET https:\/\/api\.github\.com\/repos\/Host-It-Labs\/pomi network request failed after 3 attempts: ENOTFOUND: getaddrinfo ENOTFOUND api\.github\.com/
      );
      assert.equal(error.cause?.cause?.code, 'ENOTFOUND');
      return true;
    }
  );
});

test('returns a response after a transient safe-read failure', async () => {
  let attempts = 0;
  const response = await fetchWithRetry(
    'https://api.github.com/repos/Host-It-Labs/pomi',
    {},
    async () => {
      attempts += 1;
      if (attempts === 1) throw networkFailure();
      return globalThis.Response.json({ ok: true });
    },
    [0, 0, 0]
  );

  assert.equal(attempts, 2);
  assert.deepEqual(await response.json(), { ok: true });
});

test('does not retry requests that can mutate remote state', async () => {
  let attempts = 0;
  await assert.rejects(
    fetchWithRetry(
      'https://api.github.com/repos/Host-It-Labs/pomi/issues',
      { method: 'POST' },
      async () => {
        attempts += 1;
        throw networkFailure();
      },
      [0, 0, 0]
    ),
    /POST https:\/\/api\.github\.com\/repos\/Host-It-Labs\/pomi\/issues network request failed after 1 attempt/
  );
  assert.equal(attempts, 1);
});
