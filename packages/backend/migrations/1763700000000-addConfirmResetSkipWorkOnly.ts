import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddConfirmResetSkipWorkOnly1763700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD COLUMN "confirmResetSkipWorkOnly" boolean NOT NULL DEFAULT false`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "confirmResetSkipWorkOnly"`
    );
  }
}
