import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIntentionHabitCadence1774469400000 implements MigrationInterface {
  name = 'AddIntentionHabitCadence1774469400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "intentions" ADD "habitCadence" character varying NOT NULL DEFAULT 'off'`
    );
    await queryRunner.query(
      `UPDATE "intentions" SET "habitCadence" = 'daily' WHERE "isHabit" = true`
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "intentions" DROP COLUMN "habitCadence"`
    );
  }
}
