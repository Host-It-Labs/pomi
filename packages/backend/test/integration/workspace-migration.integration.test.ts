import { DataSource } from 'typeorm';
import { expect, it } from 'vitest';
import { SoftStoneWorkspace1788600000000 } from '../../migrations/1788600000000-softStoneWorkspace';

it.runIf(Boolean(process.env.DATABASE_URL))(
  'restores each break visibility preference on workspace rollback',
  async () => {
    const source = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL,
    });
    await source.initialize();
    const runner = source.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await runner.query('CREATE SCHEMA workspace_migration_test');
      await runner.query('SET LOCAL search_path TO workspace_migration_test');
      await runner.query(
        `CREATE TABLE preferences (id uuid PRIMARY KEY, "tasksDuringBreaks" boolean NOT NULL, "tasksExtension" boolean DEFAULT false, "intentionExtension" boolean DEFAULT false, "sessionsExtension" boolean DEFAULT false, "listsExtension" boolean DEFAULT false, "intentionCustomDurations" boolean DEFAULT false, "intentionSubIntentions" boolean DEFAULT false, "advancedSkip" boolean DEFAULT false, "timerExtension" boolean DEFAULT false)`
      );
      await runner.query(
        `INSERT INTO preferences (id, "tasksDuringBreaks") VALUES ('00000000-0000-4000-8000-000000000001', false), ('00000000-0000-4000-8000-000000000002', true)`
      );
      const migration = new SoftStoneWorkspace1788600000000();
      await migration.up(runner);
      await migration.down(runner);
      expect(
        await runner.query(
          'SELECT "tasksDuringBreaks" FROM preferences ORDER BY id'
        )
      ).toEqual([{ tasksDuringBreaks: false }, { tasksDuringBreaks: true }]);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
      await source.destroy();
    }
  }
);
