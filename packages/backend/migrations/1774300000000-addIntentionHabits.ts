import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIntentionHabits1774300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "intentionHabits" boolean NOT NULL DEFAULT false`
    );
    await queryRunner.query(
      `ALTER TABLE "intentions" ADD "isHabit" boolean NOT NULL DEFAULT false`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "intentions" DROP COLUMN "isHabit"`);
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "intentionHabits"`
    );
  }
}
