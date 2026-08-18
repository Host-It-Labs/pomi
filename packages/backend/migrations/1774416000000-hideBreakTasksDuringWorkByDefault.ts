import { MigrationInterface, QueryRunner } from 'typeorm';

export class HideBreakTasksDuringWorkByDefault1774416000000 implements MigrationInterface {
  name = 'HideBreakTasksDuringWorkByDefault1774416000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" ALTER COLUMN "tasksShowBreakTasksDuringWork" SET DEFAULT false`
    );
    await queryRunner.query(
      `UPDATE "preferences" SET "tasksShowBreakTasksDuringWork" = false WHERE "tasksShowBreakTasksDuringWork" = true`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "preferences" SET "tasksShowBreakTasksDuringWork" = true WHERE "tasksShowBreakTasksDuringWork" = false`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ALTER COLUMN "tasksShowBreakTasksDuringWork" SET DEFAULT true`
    );
  }
}
