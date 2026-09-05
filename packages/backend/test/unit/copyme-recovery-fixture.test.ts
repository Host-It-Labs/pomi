import { describe, expect, it } from 'vitest';
import { buildCopymeRecoveryStatuses } from '../../scripts/seed-user-fixture';

describe('Copyme user action recovery fixtures', () => {
  it('uses stable IDs and metadata-only representative domains', () => {
    expect(buildCopymeRecoveryStatuses(10_000)).toEqual([
      expect.objectContaining({
        actionId: '00000000-0000-4000-8000-000000000222',
        status: 'succeeded',
        action: { kind: 'timer', operation: 'pause' },
      }),
      expect.objectContaining({
        actionId: '00000000-0000-4000-8000-000000000223',
        status: 'succeeded',
        action: { kind: 'tasks', operation: 'update' },
      }),
    ]);
  });
});
