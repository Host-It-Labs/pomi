import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTaskModePreference1774410000000 implements MigrationInterface {
  name = 'AddTaskModePreference1774410000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "tasksAutoSwitchToIntentionMode" boolean NOT NULL DEFAULT true`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "tasksAutoSwitchToIntentionMode"`
    );
  }
}
