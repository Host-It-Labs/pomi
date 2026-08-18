import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTaskEventsAndReminders1774406000000 implements MigrationInterface {
  name = 'AddTaskEventsAndReminders1774406000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD "dueTime" character varying`
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD "lastReminderKey" character varying`
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD "reminderEnabled" boolean NOT NULL DEFAULT false`
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD "reminderBeforeMinutes" integer NOT NULL DEFAULT 0`
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD "urgentAlarmEnabled" boolean NOT NULL DEFAULT false`
    );
    await queryRunner.query(
      `CREATE TABLE "task_events" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "taskId" uuid NOT NULL, "eventType" character varying NOT NULL, "dueDate" date, "dueTime" character varying, "occurredAt" TIMESTAMP NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_task_events_id" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tasks_active_due_reminder_scan" ON "tasks" ("dueDate", "dueTime") WHERE "status" = 'active' AND "dueDate" IS NOT NULL AND ("reminderEnabled" = true OR "urgentAlarmEnabled" = true)`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_task_events_user_occurred_at" ON "task_events" ("userId", "occurredAt")`
    );
    await queryRunner.query(
      `ALTER TABLE "task_events" ADD CONSTRAINT "FK_task_events_task" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "task_events" DROP CONSTRAINT "FK_task_events_task"`
    );
    await queryRunner.query(`DROP INDEX "IDX_task_events_user_occurred_at"`);
    await queryRunner.query(`DROP INDEX "IDX_tasks_active_due_reminder_scan"`);
    await queryRunner.query(`DROP TABLE "task_events"`);
    await queryRunner.query(
      `ALTER TABLE "tasks" DROP COLUMN "lastReminderKey"`
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
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "dueTime"`);
  }
}
