import { MigrationInterface, QueryRunner } from 'typeorm';

export class CentralizeTaskReminders1774467400000 implements MigrationInterface {
  name = 'CentralizeTaskReminders1774467400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "taskReminderPriorities" jsonb NOT NULL DEFAULT '["high", "urgent"]'::jsonb`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "taskUrgentReminderRepeatEnabled" boolean NOT NULL DEFAULT true`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "taskUrgentReminderRepeatIntervalMinutes" integer NOT NULL DEFAULT 30`
    );
    await queryRunner.query(`
      UPDATE "preferences"
      SET
        "taskReminderPriorities" = CASE
          WHEN "taskLowNormalDueReminders" AND "taskHighUrgentDueReminders"
            THEN '["low", "normal", "high", "urgent"]'::jsonb
          WHEN "taskLowNormalDueReminders"
            THEN '["low", "normal"]'::jsonb
          WHEN "taskHighUrgentDueReminders"
            THEN '["high", "urgent"]'::jsonb
          ELSE '[]'::jsonb
        END,
        "taskUrgentReminderRepeatEnabled" =
          "taskMobileUrgentAlarms" OR "taskDesktopUrgentAlarms",
        "taskUrgentReminderRepeatIntervalMinutes" =
          "taskUrgentAlarmIntervalMinutes"
    `);

    await queryRunner.query(`DROP INDEX "IDX_tasks_active_due_reminder_scan"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_tasks_active_due_notification_scan" ON "tasks" ("dueDate", "dueTime") WHERE "status" = 'active' AND "dueDate" IS NOT NULL AND "itemKind" = 'task'`
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" DROP COLUMN "urgentAlarmEnabled"`
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" DROP COLUMN "reminderBeforeMinutes"`
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" DROP COLUMN "reminderEnabled"`
    );

    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "taskDesktopUrgentAlarms"`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "taskMobileUrgentAlarms"`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "taskUrgentAlarmIntervalMinutes"`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "taskLowNormalDueReminders"`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "taskHighUrgentDueReminders"`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "taskHighUrgentDueReminders" boolean NOT NULL DEFAULT true`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "taskLowNormalDueReminders" boolean NOT NULL DEFAULT false`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "taskUrgentAlarmIntervalMinutes" integer NOT NULL DEFAULT 30`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "taskMobileUrgentAlarms" boolean NOT NULL DEFAULT true`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "taskDesktopUrgentAlarms" boolean NOT NULL DEFAULT true`
    );
    await queryRunner.query(`
      UPDATE "preferences"
      SET
        "taskHighUrgentDueReminders" =
          "taskReminderPriorities" ? 'high' OR "taskReminderPriorities" ? 'urgent',
        "taskLowNormalDueReminders" =
          "taskReminderPriorities" ? 'low' OR "taskReminderPriorities" ? 'normal',
        "taskUrgentAlarmIntervalMinutes" =
          "taskUrgentReminderRepeatIntervalMinutes",
        "taskMobileUrgentAlarms" = "taskUrgentReminderRepeatEnabled",
        "taskDesktopUrgentAlarms" = "taskUrgentReminderRepeatEnabled"
    `);

    await queryRunner.query(
      `ALTER TABLE "tasks" ADD "reminderEnabled" boolean NOT NULL DEFAULT false`
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD "reminderBeforeMinutes" integer NOT NULL DEFAULT 0`
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD "urgentAlarmEnabled" boolean NOT NULL DEFAULT false`
    );
    await queryRunner.query(`
      UPDATE "tasks" AS task
      SET
        "reminderEnabled" = preferences."taskReminderPriorities" ? task."priority",
        "reminderBeforeMinutes" = preferences."taskBeforeDueReminderMinutes",
        "urgentAlarmEnabled" =
          task."priority" = 'urgent'
          AND preferences."taskUrgentReminderRepeatEnabled"
      FROM "preferences" AS preferences
      WHERE preferences."userId" = task."userId"
    `);
    await queryRunner.query(
      `DROP INDEX "IDX_tasks_active_due_notification_scan"`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tasks_active_due_reminder_scan" ON "tasks" ("dueDate", "dueTime") WHERE "status" = 'active' AND "dueDate" IS NOT NULL AND ("reminderEnabled" = true OR "urgentAlarmEnabled" = true)`
    );

    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "taskUrgentReminderRepeatIntervalMinutes"`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "taskUrgentReminderRepeatEnabled"`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "taskReminderPriorities"`
    );
  }
}
