import assert from 'node:assert/strict';
import test from 'node:test';
import {
  archivedDiscussionBody,
  translatedPullBody,
} from './migrate-private-pulls.mjs';

test('translates Radar issue references and adds a stable source marker', () => {
  const body = translatedPullBody(
    {
      number: 10,
      body: '<!-- pomi-radar-source:v1 {"version":1,"track":"bug","issues":[5]} -->\nhttps://github.com/NeoHuncho/pomi-private/issues/5',
      html_url: 'https://github.com/NeoHuncho/pomi-private/pull/10',
    },
    'NeoHuncho/pomi-private',
    new Map([[5, 42]])
  );
  assert.match(body, /"issues":\[42\]/);
  assert.match(body, /Host-It-Labs\/pomi\/issues\/42/);
  assert.match(body, /pomi-pull-migration:v1/);
});

test('requires every Radar source issue to exist publicly', () => {
  assert.throws(
    () =>
      translatedPullBody(
        {
          number: 10,
          body: '<!-- pomi-radar-source:v1 {"issues":[5]} -->',
          html_url: 'https://example.invalid',
        },
        'NeoHuncho/pomi-private',
        new Map()
      ),
    /has not been migrated/
  );
});

test('archives discussion context with an idempotency marker', () => {
  const body = archivedDiscussionBody(
    {
      id: 99,
      body: 'Finding text',
      user: { login: 'reviewer' },
      created_at: '2026-01-01T00:00:00Z',
      path: 'src/file.ts',
      line: 12,
    },
    {
      sourceRepository: 'NeoHuncho/pomi-private',
      sourcePull: 10,
      kind: 'inline review comment',
    }
  );
  assert.match(body, /@reviewer/);
  assert.match(body, /src\/file.ts/);
  assert.match(body, /pomi-pull-migration:v1:discussion/);
});
