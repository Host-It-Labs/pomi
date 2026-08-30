import { MigrationInterface, QueryRunner } from 'typeorm';

export class UnifyBreakAutoStart1774469000000 implements MigrationInterface {
  name = 'UnifyBreakAutoStart1774469000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "resetBreakOnFirstIntention" boolean NOT NULL DEFAULT false`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "resetLongBreakOnFirstIntention" boolean NOT NULL DEFAULT false`
    );
    await queryRunner.query(`
      UPDATE "preferences"
      SET "autoStartBreak" = "autoStartBreak" OR "sessionLongBreakAutoStart"
    `);
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "sessionLongBreakAutoStart"`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "sessionLongBreakAutoStart" boolean NOT NULL DEFAULT false`
    );
    await queryRunner.query(
      `UPDATE "preferences" SET "sessionLongBreakAutoStart" = "autoStartBreak"`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "resetLongBreakOnFirstIntention"`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "resetBreakOnFirstIntention"`
    );
  }
}
