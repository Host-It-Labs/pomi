import { MigrationInterface, QueryRunner } from 'typeorm';

export class PageTaskArchiveHistory1774469300000 implements MigrationInterface {
  name = 'PageTaskArchiveHistory1774469300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_tasks_archive_page" ON "tasks" ("userId", "updatedAt" DESC, "id" DESC) WHERE "status" IN ('completed', 'archived') AND "itemKind" IN ('task', 'followUp')`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_tasks_archive_page"`);
  }
}
