import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTaskBreakVisibilityAndHelpTips1774412000000 implements MigrationInterface {
  name = 'AddTaskBreakVisibilityAndHelpTips1774412000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "tasksHideDuringBreaks" boolean NOT NULL DEFAULT false`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "hiddenHelpTips" jsonb NOT NULL DEFAULT '[]'::jsonb`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "hiddenHelpTips"`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "tasksHideDuringBreaks"`
    );
  }
}
