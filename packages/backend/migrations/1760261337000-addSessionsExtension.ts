import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSessionsExtension1760261337000 implements MigrationInterface {
  name = 'AddSessionsExtension1760261337000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "sessionsExtension" boolean NOT NULL DEFAULT false`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "sessionPomodorosCount" integer NOT NULL DEFAULT 3`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "sessionHasLongBreak" boolean NOT NULL DEFAULT true`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "sessionLongBreakDuration" integer NOT NULL DEFAULT 900000`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "sessionLongBreakAutoStart" boolean NOT NULL DEFAULT false`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "sessionLongBreakAutoStart"`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "sessionLongBreakDuration"`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "sessionHasLongBreak"`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "sessionPomodorosCount"`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "sessionsExtension"`
    );
  }
}
