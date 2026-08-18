import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveAlwaysShowExtrasSettings1767000000000 implements MigrationInterface {
  name = 'RemoveAlwaysShowExtrasSettings1767000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "alwaysShowExtrasSettings"`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "alwaysShowExtrasSettings" boolean NOT NULL DEFAULT false`
    );
  }
}
