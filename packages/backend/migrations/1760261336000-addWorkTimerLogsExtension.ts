import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWorkTimerLogsExtension1760261336000 implements MigrationInterface {
  name = 'AddWorkTimerLogsExtension1760261336000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "workTimerLogsExtension" boolean NOT NULL DEFAULT false`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "workTimerLogsExtension"`
    );
  }
}
