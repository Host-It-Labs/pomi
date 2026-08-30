import { expect, test } from 'vitest';
import { AddTaskCustomDuration1774469100000 } from '../../migrations/1774469100000-addTaskCustomDuration';

test('Task custom duration migration adds and removes a nullable integer column', async () => {
  const queries: string[] = [];
  const migration = new AddTaskCustomDuration1774469100000();
  const queryRunner = {
    query: async (query: string) => {
      queries.push(query);
    },
  };

  await migration.up(queryRunner as never);
  await migration.down(queryRunner as never);

  expect(queries).toEqual([
    'ALTER TABLE "tasks" ADD "customDuration" integer',
    'ALTER TABLE "tasks" DROP COLUMN "customDuration"',
  ]);
});
