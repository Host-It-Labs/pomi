import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTaskImportSourceMetadata1774415000000
  implements MigrationInterface
{
  name = 'AddTaskImportSourceMetadata1774415000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD "importSource" character varying`
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD "importSourceTaskId" character varying`
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_tasks_import_source_task" ON "tasks" ("userId", "importSource", "importSourceTaskId") WHERE "importSource" IS NOT NULL AND "importSourceTaskId" IS NOT NULL`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_tasks_import_source_task"`);
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "importSourceTaskId"`);
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "importSource"`);
  }
}
