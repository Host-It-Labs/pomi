import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSettingsExtrasAndDefaults1766700000000 implements MigrationInterface {
  name = 'AddSettingsExtrasAndDefaults1766700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "alwaysShowExtrasSettings" boolean NOT NULL DEFAULT false`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ALTER COLUMN "autoStartBreak" SET DEFAULT false`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ALTER COLUMN "workTimerLogsExtension" SET DEFAULT true`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" ALTER COLUMN "workTimerLogsExtension" SET DEFAULT false`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ALTER COLUMN "autoStartBreak" SET DEFAULT true`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "alwaysShowExtrasSettings"`
    );
  }
}
