import assert from 'node:assert/strict';
import test from 'node:test';

import { sentryChildEnvironment } from './run-pomi-sentry.mjs';

test('removes private-key variables from the Sentry child environment', () => {
  const result = sentryChildEnvironment({
    environment: {
      SENTRY_AUTH_TOKEN: 'token',
      SENTRY_ORG: 'org',
      SENTRY_FRONTEND_PROJECT: 'frontend',
      SENTRY_BACKEND_PROJECT: 'backend',
      POMI_RADAR_GITHUB_APP_PRIVATE_KEY: 'sentinel-key',
      POMI_RADAR_GITHUB_APP_PRIVATE_KEY_PATH: 'sentinel-path',
      GITHUB_FEEDBACK_APP_PRIVATE_KEY: 'sentinel-feedback-key',
      GITHUB_FEEDBACK_APP_PRIVATE_KEY_PATH: 'sentinel-feedback-path',
    },
    filePath: '/does/not/exist',
  });
  assert.equal(result.environment.SENTRY_AUTH_TOKEN, 'token');
  assert.equal(result.environment.SENTRY_ENVIRONMENT, 'production');
  assert.equal(result.environment.POMI_RADAR_GITHUB_APP_PRIVATE_KEY, undefined);
  assert.equal(
    result.environment.POMI_RADAR_GITHUB_APP_PRIVATE_KEY_PATH,
    undefined
  );
  assert.equal(result.environment.GITHUB_FEEDBACK_APP_PRIVATE_KEY, undefined);
  assert.equal(
    result.environment.GITHUB_FEEDBACK_APP_PRIVATE_KEY_PATH,
    undefined
  );
  assert.doesNotMatch(JSON.stringify(result.environment), /sentinel/);
});
