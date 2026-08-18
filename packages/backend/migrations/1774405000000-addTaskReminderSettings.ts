import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTaskReminderSettings1774405000000 implements MigrationInterface {
  name = 'AddTaskReminderSettings1774405000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "taskHighUrgentDueReminders" boolean NOT NULL DEFAULT true`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "taskLowNormalDueReminders" boolean NOT NULL DEFAULT false`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "taskBeforeDueReminderMinutes" integer NOT NULL DEFAULT 0`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "taskUrgentAlarmIntervalMinutes" integer NOT NULL DEFAULT 30`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "taskMobileUrgentAlarms" boolean NOT NULL DEFAULT true`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "taskDesktopUrgentAlarms" boolean NOT NULL DEFAULT true`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "taskDesktopUrgentAlarms"`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "taskMobileUrgentAlarms"`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "taskUrgentAlarmIntervalMinutes"`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "taskBeforeDueReminderMinutes"`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "taskLowNormalDueReminders"`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "taskHighUrgentDueReminders"`
    );
  }
}
