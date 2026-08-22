import assert from 'node:assert/strict';
import test from 'node:test';
import {
  migratedIssueBody,
  migrationMarker,
  translatedLabels,
} from './migrate-private-radar.mjs';

test('adds a stable source marker to migrated issues', () => {
  const body = migratedIssueBody(
    { number: 243, body: 'Original body' },
    'NeoHuncho/pomi-private'
  );
  assert.match(body, /Original body/);
  assert.match(body, /pomi-radar-migration:v1/);
  assert.match(
    body,
    /https:\/\/github\.com\/NeoHuncho\/pomi-private\/issues\/243/
  );
  assert.ok(body.includes(migrationMarker('NeoHuncho/pomi-private', 243)));
});

test('moves private-PR-dependent active work to needs-agent', () => {
  assert.deepEqual(
    translatedLabels(
      ['radar:feature', 'radar:in-review'],
      [{ body: 'See https://github.com/NeoHuncho/pomi-private/pull/99' }]
    ),
    ['radar:feature', 'radar:needs-agent']
  );
});

test('preserves proposal labels without a private source PR', () => {
  assert.deepEqual(translatedLabels(['radar:bug', 'radar:proposed'], []), [
    'radar:bug',
    'radar:proposed',
  ]);
});
