import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddHabitPrioritizationPreference1774469300000 implements MigrationInterface {
  name = 'AddHabitPrioritizationPreference1774469300000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "intentionPrioritizeUnfinishedHabits" boolean NOT NULL DEFAULT false`
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "intentionPrioritizeUnfinishedHabits"`
    );
  }
}
