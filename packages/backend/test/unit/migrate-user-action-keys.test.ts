import { describe, expect, it } from 'vitest';
import {
  assertUserActionCutoverDrained,
  taggedUserActionKey,
} from '../../scripts/migrate-user-action-keys';

describe('user-action key migration', () => {
  it('maps every live legacy key type into one per-user hash slot', () => {
    const sources = [
      'pomi:user-actions:record:user-1:action:1',
      'pomi:user-actions:tombstone:user-1:action:1',
      'pomi:user-actions:execution:user-1:action:1',
    ];

    expect(sources.map(taggedUserActionKey)).toEqual([
      'pomi:user-actions:{user-1}:record:action:1',
      'pomi:user-actions:{user-1}:tombstone:action:1',
      'pomi:user-actions:{user-1}:execution:action:1',
    ]);
  });

  it('ignores queues, locks, and already-tagged keys', () => {
    expect(taggedUserActionKey('pomi:user-actions:queue:user-1')).toBeNull();
    expect(taggedUserActionKey('pomi:user-actions:lock:user-1')).toBeNull();
    expect(
      taggedUserActionKey('pomi:user-actions:{user-1}:record:action-1')
    ).toBeNull();
  });
});

it('refuses a cutover while tagged queues or locks contain live work', async () => {
  const keys = new Map([
    ['pomi:user-actions:{*}:queue', ['pomi:user-actions:{user-1}:queue']],
    ['pomi:user-actions:{*}:lock', ['pomi:user-actions:{user-2}:lock']],
  ]);
  const redis = {
    scan: async (_cursor: string, _match: string, pattern: string) => [
      '0',
      keys.get(pattern) ?? [],
    ],
  };

  await expect(assertUserActionCutoverDrained(redis as never)).rejects.toThrow(
    '0 legacy queues, 0 legacy locks, 1 tagged queues, and 1 tagged locks'
  );
});
