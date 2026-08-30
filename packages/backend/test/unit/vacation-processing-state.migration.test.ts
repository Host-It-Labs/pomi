import { describe, expect, it, vi } from 'vitest';
import { PersistVacationProcessingState1774469000000 } from '../../migrations/1774469000000-persistVacationProcessingState';

describe('PersistVacationProcessingState1774469000000', () => {
  it('adds the persisted processing date and time zone', async () => {
    const query = vi.fn(async () => undefined);
    const migration = new PersistVacationProcessingState1774469000000();

    await migration.up({ query } as never);

    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      `ALTER TABLE "vacation_states" ADD "lastProcessedOn" date`,
      `ALTER TABLE "vacation_states" ADD "lastProcessedTimeZone" character varying`,
    ]);
  });

  it('removes the time zone before the processing date on rollback', async () => {
    const query = vi.fn(async () => undefined);
    const migration = new PersistVacationProcessingState1774469000000();

    await migration.down({ query } as never);

    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      `ALTER TABLE "vacation_states" DROP COLUMN "lastProcessedTimeZone"`,
      `ALTER TABLE "vacation_states" DROP COLUMN "lastProcessedOn"`,
    ]);
  });
});
