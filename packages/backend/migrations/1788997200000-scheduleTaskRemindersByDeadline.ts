import { MigrationInterface, QueryRunner } from 'typeorm';

export class ScheduleTaskRemindersByDeadline1788997200000 implements MigrationInterface {
  name = 'ScheduleTaskRemindersByDeadline1788997200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD "nextReminderAt" TIMESTAMPTZ`
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD "reminderClaimToken" uuid`
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD "reminderClaimedUntil" TIMESTAMPTZ`
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD "lastUrgentReminderAt" TIMESTAMPTZ`
    );
    await queryRunner.query(`
      CREATE INDEX "IDX_tasks_due_reminder_schedule"
      ON "tasks" ("nextReminderAt", "id")
      WHERE "nextReminderAt" IS NOT NULL
        AND "status" = 'active'
        AND "itemKind" IN ('task', 'followUp')
    `);
    await queryRunner.query(
      `DROP INDEX "IDX_tasks_active_due_notification_scan"`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX "IDX_tasks_active_due_notification_scan"
      ON "tasks" ("dueDate", "dueTime")
      WHERE "status" = 'active'
        AND "dueDate" IS NOT NULL
      AND "itemKind" IN ('task', 'followUp')
    `);
    await queryRunner.query(`DROP INDEX "IDX_tasks_due_reminder_schedule"`);
    await queryRunner.query(
      `ALTER TABLE "tasks" DROP COLUMN "lastUrgentReminderAt"`
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" DROP COLUMN "reminderClaimedUntil"`
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" DROP COLUMN "reminderClaimToken"`
    );
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "nextReminderAt"`);
  }
}
