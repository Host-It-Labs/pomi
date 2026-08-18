import { MigrationInterface, QueryRunner } from 'typeorm';

export class AppExperienceTaskSemantics1774459000000 implements MigrationInterface {
  name = 'AppExperienceTaskSemantics1774459000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "taskOverdueGraceDays"`
    );
    await queryRunner.query(
      `ALTER TABLE "task_events" ADD "recurrenceRuleSnapshot" character varying`
    );
    await queryRunner.query(`
      INSERT INTO "task_events" (
        "id", "userId", "taskId", "eventType", "titleSnapshot",
        "prioritySnapshot", "timerTypeSnapshot", "intentionSlugSnapshot",
        "subIntentionSlugSnapshot", "dueDate", "dueTime",
        "recurrenceSequenceIndex", "recurrenceRuleSnapshot", "isOverdue",
        "occurredAt", "createdAt"
      )
      SELECT
        uuid_generate_v4(), task."userId", task."id", 'created', task."title",
        task."priority", task."timerType", task."intentionSlug",
        task."subIntentionSlug", task."dueDate", task."dueTime", 0,
        task."recurrenceRule", false, task."createdAt", now()
      FROM "tasks" task
      WHERE NOT EXISTS (
        SELECT 1 FROM "task_events" event
        WHERE event."taskId" = task."id" AND event."eventType" = 'created'
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_task_events_one_created_per_task" ON "task_events" ("taskId") WHERE "eventType" = 'created'`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "IDX_task_events_one_created_per_task"`
    );
    await queryRunner.query(
      `DELETE FROM "task_events" WHERE "eventType" = 'created'`
    );
    await queryRunner.query(
      `ALTER TABLE "task_events" DROP COLUMN "recurrenceRuleSnapshot"`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "taskOverdueGraceDays" integer NOT NULL DEFAULT 1`
    );
  }
}
