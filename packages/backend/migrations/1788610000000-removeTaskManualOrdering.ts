import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveTaskManualOrdering1788610000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    // Retain previous values solely for a data-preserving rollback.
    await queryRunner.query(`
      CREATE TABLE "retired_task_ordering" (
        "taskId" uuid PRIMARY KEY REFERENCES "tasks"("id") ON DELETE CASCADE,
        "position" integer,
        "overridden" boolean NOT NULL
      )
    `);
    await queryRunner.query(`
      INSERT INTO "retired_task_ordering" ("taskId", "position", "overridden")
      SELECT "id", "manualOrder", "manualOrderOverride" FROM "tasks"
      WHERE "manualOrder" IS NOT NULL OR "manualOrderOverride" = true
    `);
    await queryRunner.query(
      `ALTER TABLE "tasks" DROP COLUMN "manualOrder", DROP COLUMN "manualOrderOverride"`
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD "manualOrder" integer, ADD "manualOrderOverride" boolean NOT NULL DEFAULT false`
    );
    await queryRunner.query(`
      UPDATE "tasks" AS task
      SET "manualOrder" = previous."position", "manualOrderOverride" = previous."overridden"
      FROM "retired_task_ordering" AS previous
      WHERE task."id" = previous."taskId"
    `);
    await queryRunner.query(`DROP TABLE "retired_task_ordering"`);
  }
}
