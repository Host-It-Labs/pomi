import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveAdvancedSkip1767500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN IF EXISTS "advancedSkip"`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "advancedSkip" boolean NOT NULL DEFAULT true`
    );
  }
}
