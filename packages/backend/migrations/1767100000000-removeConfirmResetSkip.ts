import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveConfirmResetSkip1767100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "confirmResetSkipWorkOnly"`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "confirmResetSkip"`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "confirmResetSkip" boolean NOT NULL DEFAULT false`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "confirmResetSkipWorkOnly" boolean NOT NULL DEFAULT false`
    );
  }
}
