import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSessionShowLongBreakButton1763300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "sessionShowLongBreakButton" boolean NOT NULL DEFAULT false`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "sessionShowLongBreakButton"`
    );
  }
}
