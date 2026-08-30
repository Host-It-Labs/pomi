import { MigrationInterface, QueryRunner } from 'typeorm';

export class TargetTimerAutomation1774469200000 implements MigrationInterface {
  name = 'TargetTimerAutomation1774469200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "autoStartWork" boolean NOT NULL DEFAULT false`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "autoStartLongBreak" boolean NOT NULL DEFAULT false`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "resetWorkOnFirstIntention" boolean NOT NULL DEFAULT false`
    );
    await queryRunner.query(
      `UPDATE "preferences" SET "autoStartLongBreak" = "autoStartBreak"`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "resetWorkOnFirstIntention"`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "autoStartLongBreak"`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "autoStartWork"`
    );
  }
}
