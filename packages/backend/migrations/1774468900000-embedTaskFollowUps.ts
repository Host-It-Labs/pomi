import { MigrationInterface, QueryRunner } from 'typeorm';

export class EmbedTaskFollowUps1774468900000 implements MigrationInterface {
  name = 'EmbedTaskFollowUps1774468900000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD "followUpDefinition" jsonb`
    );
    await queryRunner.query(`
      UPDATE "tasks" AS source
      SET "followUpDefinition" = jsonb_build_object(
        'title', template."title",
        'description', template."description",
        'dueTime', template."dueTime",
        'priority', template."priority",
        'timerType', template."timerType",
        'intentionSlug', template."intentionSlug",
        'subIntentionSlug', template."subIntentionSlug",
        'vacationEligible', template."vacationEligible"
      )
      FROM "tasks" AS template
      WHERE source."followUpTaskId" = template."id"
        AND source."itemKind" = 'task'
        AND template."itemKind" = 'task'
    `);
    await queryRunner.query(`
      UPDATE "tasks"
      SET "itemKind" = 'followUpTemplate'
      WHERE "id" IN (
        SELECT DISTINCT "followUpTaskId"
        FROM "tasks"
        WHERE "followUpTaskId" IS NOT NULL
      )
    `);
    await queryRunner.query(`
      UPDATE "tasks"
      SET "followUpTaskId" = NULL
      WHERE "followUpDefinition" IS NOT NULL
    `);
    await queryRunner.query(`
      UPDATE "tasks"
      SET "itemKind" = 'followUp'
      WHERE "followUpSourceTaskId" IS NOT NULL
        AND "itemKind" = 'task'
    `);
    await queryRunner.query(`DROP INDEX "UQ_tasks_active_follow_up_source"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_tasks_active_follow_up_source" ON "tasks" ("followUpSourceTaskId") WHERE "followUpSourceTaskId" IS NOT NULL AND "status" = 'active' AND "itemKind" = 'followUp'`
    );
    await queryRunner.query(
      `DROP INDEX "IDX_tasks_active_due_notification_scan"`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tasks_active_due_notification_scan" ON "tasks" ("dueDate", "dueTime") WHERE "status" = 'active' AND "dueDate" IS NOT NULL AND "itemKind" IN ('task', 'followUp')`
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_tasks_active_follow_up_source"`);
    await queryRunner.query(
      `DROP INDEX "IDX_tasks_active_due_notification_scan"`
    );
    await queryRunner.query(`
      UPDATE "tasks"
      SET "itemKind" = 'task'
      WHERE "itemKind" IN ('followUp', 'followUpTemplate')
    `);
    await queryRunner.query(
      `ALTER TABLE "tasks" DROP COLUMN "followUpDefinition"`
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_tasks_active_follow_up_source" ON "tasks" ("followUpSourceTaskId") WHERE "followUpSourceTaskId" IS NOT NULL AND "status" = 'active' AND "itemKind" = 'task'`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tasks_active_due_notification_scan" ON "tasks" ("dueDate", "dueTime") WHERE "status" = 'active' AND "dueDate" IS NOT NULL AND "itemKind" = 'task'`
    );
  }
}
