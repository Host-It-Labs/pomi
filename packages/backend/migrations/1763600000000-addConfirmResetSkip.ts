import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddConfirmResetSkip1763600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD COLUMN "confirmResetSkip" boolean NOT NULL DEFAULT false`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "confirmResetSkip"`
    );
  }
}
