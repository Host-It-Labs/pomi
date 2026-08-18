import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTaskManualOrder1774418000000 implements MigrationInterface {
  name = 'AddTaskManualOrder1774418000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tasks" ADD "manualOrder" integer`);
    await queryRunner.query(`
      UPDATE "tasks"
      SET "manualOrder" = ranked."manualOrder"
      FROM (
        SELECT
          "id",
          ROW_NUMBER() OVER (
            PARTITION BY "userId"
            ORDER BY "createdAt" ASC, "id" ASC
          ) - 1 AS "manualOrder"
        FROM "tasks"
        WHERE "status" = 'active' AND "dueDate" IS NULL
      ) ranked
      WHERE "tasks"."id" = ranked."id"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "manualOrder"`);
  }
}
