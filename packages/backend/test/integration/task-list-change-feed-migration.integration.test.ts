import { DataSource } from 'typeorm';
import { expect, it } from 'vitest';
import { AddTaskListChangeFeed1788997300000 } from '../../migrations/1788997300000-addTaskListChangeFeed';

it.runIf(Boolean(process.env.DATABASE_URL))(
  'records committed Task and List changes in isolated user revisions',
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
      await runner.query('CREATE SCHEMA task_list_change_feed_test');
      await runner.query('SET LOCAL search_path TO task_list_change_feed_test');
      await runner.query(`CREATE TABLE "users" ("id" uuid PRIMARY KEY)`);
      await runner.query(`
        CREATE TABLE "tasks" (
          "id" uuid PRIMARY KEY,
          "userId" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
          "title" varchar NOT NULL,
          "status" varchar NOT NULL,
          "itemKind" varchar NOT NULL,
          "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
          "lastReminderKey" varchar,
          "nextReminderAt" TIMESTAMPTZ,
          "reminderClaimToken" uuid,
          "reminderClaimedUntil" TIMESTAMPTZ,
          "lastUrgentReminderAt" TIMESTAMPTZ
        )
      `);
      await runner.query(`
        CREATE TABLE "lists" (
          "id" uuid PRIMARY KEY,
          "userId" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
          "title" varchar NOT NULL,
          "isArchived" boolean NOT NULL DEFAULT false,
          "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await runner.query(`
        INSERT INTO "users" ("id") VALUES
          ('00000000-0000-4000-8000-000000000001'),
          ('00000000-0000-4000-8000-000000000002')
      `);

      const migration = new AddTaskListChangeFeed1788997300000();
      await migration.up(runner);
      await runner.query(`
        INSERT INTO "tasks" ("id", "userId", "title", "status", "itemKind")
        VALUES (
          '10000000-0000-4000-8000-000000000001',
          '00000000-0000-4000-8000-000000000001',
          'First', 'active', 'task'
        )
      `);
      await runner.query(`
        INSERT INTO "lists" ("id", "userId", "title")
        VALUES (
          '20000000-0000-4000-8000-000000000001',
          '00000000-0000-4000-8000-000000000001',
          'List'
        )
      `);
      await runner.query(`
        INSERT INTO "tasks" ("id", "userId", "title", "status", "itemKind")
        VALUES (
          '10000000-0000-4000-8000-000000000002',
          '00000000-0000-4000-8000-000000000002',
          'Other user', 'active', 'listItem'
        )
      `);
      await runner.query(`
        UPDATE "tasks"
        SET "nextReminderAt" = now(), "updatedAt" = now()
        WHERE "id" = '10000000-0000-4000-8000-000000000001'
      `);

      expect(
        await runner.query(`
          SELECT "userId", "revision" FROM "task_list_revision_counters"
          ORDER BY "userId"
        `)
      ).toEqual([
        { userId: '00000000-0000-4000-8000-000000000001', revision: '2' },
        { userId: '00000000-0000-4000-8000-000000000002', revision: '1' },
      ]);
      expect(
        await runner.query(`
          SELECT "revision", "entityType", "operation"
          FROM "task_list_changes"
          WHERE "userId" = '00000000-0000-4000-8000-000000000001'
          ORDER BY "revision"
        `)
      ).toEqual([
        { revision: '1', entityType: 'task', operation: 'upsert' },
        { revision: '2', entityType: 'list', operation: 'upsert' },
      ]);

      await expect(
        runner.query(`
          DELETE FROM "users"
          WHERE "id" = '00000000-0000-4000-8000-000000000001'
        `)
      ).resolves.toEqual([[], 1]);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
      await source.destroy();
    }
  }
);
