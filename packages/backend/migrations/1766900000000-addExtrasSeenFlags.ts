import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddExtrasSeenFlags1766900000000 implements MigrationInterface {
  name = 'AddExtrasSeenFlags1766900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "timerExtrasSeen" boolean NOT NULL DEFAULT false`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "sessionsExtrasSeen" boolean NOT NULL DEFAULT false`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "intentionsExtrasSeen" boolean NOT NULL DEFAULT false`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "intentionsExtrasSeen"`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "sessionsExtrasSeen"`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "timerExtrasSeen"`
    );
  }
}
