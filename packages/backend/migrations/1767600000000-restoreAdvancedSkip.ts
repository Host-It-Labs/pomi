import { MigrationInterface, QueryRunner } from 'typeorm';

export class RestoreAdvancedSkip1767600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD COLUMN IF NOT EXISTS "advancedSkip" boolean NOT NULL DEFAULT false`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN IF EXISTS "advancedSkip"`
    );
  }
}