import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveTaskSkipAndSnapshotEvents1774411000000 implements MigrationInterface {
  name = 'RemoveTaskSkipAndSnapshotEvents1774411000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "tasks" SET "status" = 'completed' WHERE "status" = 'skipped'`
    );
    await queryRunner.query(
      `DELETE FROM "task_events" WHERE "eventType" = 'skipped'`
    );
    await queryRunner.query(
      `ALTER TABLE "task_events" ADD "titleSnapshot" character varying`
    );
    await queryRunner.query(
      `ALTER TABLE "task_events" ADD "timerTypeSnapshot" character varying NOT NULL DEFAULT 'work'`
    );
    await queryRunner.query(
      `ALTER TABLE "task_events" ADD "prioritySnapshot" character varying NOT NULL DEFAULT 'normal'`
    );
    await queryRunner.query(
      `ALTER TABLE "task_events" ADD "intentionSlugSnapshot" character varying`
    );
    await queryRunner.query(
      `ALTER TABLE "task_events" ADD "subIntentionSlugSnapshot" character varying`
    );
    await queryRunner.query(
      `ALTER TABLE "task_events" ADD "isOverdue" boolean NOT NULL DEFAULT false`
    );
    await queryRunner.query(`
      UPDATE "task_events" event
      SET
        "titleSnapshot" = task."title",
        "timerTypeSnapshot" = task."timerType",
        "prioritySnapshot" = task."priority",
        "intentionSlugSnapshot" = task."intentionSlug",
        "subIntentionSlugSnapshot" = task."subIntentionSlug",
        "isOverdue" = CASE
          WHEN event."dueDate" IS NULL THEN false
          WHEN event."dueTime" IS NULL THEN event."occurredAt" > event."dueDate" + INTERVAL '1 day'
          ELSE event."occurredAt" > event."dueDate" + event."dueTime"::time
        END
      FROM "tasks" task
      WHERE event."taskId" = task."id"
    `);
    await queryRunner.query(
      `UPDATE "task_events" SET "titleSnapshot" = 'Task' WHERE "titleSnapshot" IS NULL`
    );
    await queryRunner.query(
      `ALTER TABLE "task_events" ALTER COLUMN "titleSnapshot" SET NOT NULL`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "task_events" DROP COLUMN "isOverdue"`
    );
    await queryRunner.query(
      `ALTER TABLE "task_events" DROP COLUMN "subIntentionSlugSnapshot"`
    );
    await queryRunner.query(
      `ALTER TABLE "task_events" DROP COLUMN "intentionSlugSnapshot"`
    );
    await queryRunner.query(
      `ALTER TABLE "task_events" DROP COLUMN "prioritySnapshot"`
    );
    await queryRunner.query(
      `ALTER TABLE "task_events" DROP COLUMN "timerTypeSnapshot"`
    );
    await queryRunner.query(
      `ALTER TABLE "task_events" DROP COLUMN "titleSnapshot"`
    );
  }
}
