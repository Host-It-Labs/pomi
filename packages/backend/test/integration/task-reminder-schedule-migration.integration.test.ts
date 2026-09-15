import { DataSource } from 'typeorm';
import { expect, it } from 'vitest';
import { ScheduleTaskRemindersByDeadline1788997200000 } from '../../migrations/1788997200000-scheduleTaskRemindersByDeadline';

it.runIf(Boolean(process.env.DATABASE_URL))(
  'adds and rolls back the durable due-reminder schedule',
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
      await runner.query('CREATE SCHEMA task_reminder_schedule_test');
      await runner.query(
        'SET LOCAL search_path TO task_reminder_schedule_test'
      );
      await runner.query(`
        CREATE TABLE "tasks" (
          "id" uuid PRIMARY KEY,
          "status" varchar NOT NULL,
          "itemKind" varchar NOT NULL,
          "dueDate" date,
          "dueTime" varchar
        )
      `);
      await runner.query(`
        CREATE INDEX "IDX_tasks_active_due_notification_scan"
        ON "tasks" ("status", "dueDate")
        WHERE "status" = 'active' AND "dueDate" IS NOT NULL AND "itemKind" = 'task'
      `);

      const migration = new ScheduleTaskRemindersByDeadline1788997200000();
      await migration.up(runner);
      expect(
        await runner.query(`
          SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'task_reminder_schedule_test'
            AND table_name = 'tasks'
            AND column_name IN (
              'nextReminderAt', 'reminderClaimToken',
              'reminderClaimedUntil', 'lastUrgentReminderAt'
            )
          ORDER BY column_name
        `)
      ).toEqual([
        { column_name: 'lastUrgentReminderAt' },
        { column_name: 'nextReminderAt' },
        { column_name: 'reminderClaimToken' },
        { column_name: 'reminderClaimedUntil' },
      ]);

      await migration.down(runner);
      expect(
        await runner.query(`
          SELECT indexname FROM pg_indexes
          WHERE schemaname = 'task_reminder_schedule_test'
            AND indexname = 'IDX_tasks_active_due_notification_scan'
        `)
      ).toHaveLength(1);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
      await source.destroy();
    }
  }
);
