import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTaskImportRuns1774467300000 implements MigrationInterface {
  name = 'AddTaskImportRuns1774467300000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "task_import_runs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "source" character varying NOT NULL, "importedCount" integer NOT NULL, "skippedCount" integer NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_task_import_runs" PRIMARY KEY ("id"), CONSTRAINT "FK_task_import_runs_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE)`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_task_import_runs_user_created" ON "task_import_runs" ("userId", "createdAt")`
    );
    await queryRunner.query(
      `INSERT INTO "task_import_runs" ("userId", "source", "importedCount", "skippedCount", "createdAt") SELECT "userId", "importSource", COUNT(*)::integer, 0, MIN("createdAt") FROM "tasks" WHERE "itemKind" = 'task' AND "importSource" IS NOT NULL GROUP BY "userId", "importSource"`
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_task_import_runs_user_created"`);
    await queryRunner.query(`DROP TABLE "task_import_runs"`);
  }
}
