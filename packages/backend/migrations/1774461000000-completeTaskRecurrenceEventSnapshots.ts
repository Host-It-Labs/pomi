import { MigrationInterface, QueryRunner } from 'typeorm';

export class CompleteTaskRecurrenceEventSnapshots1774461000000 implements MigrationInterface {
  name = 'CompleteTaskRecurrenceEventSnapshots1774461000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "task_events" ADD "recurrenceIntervalSnapshot" double precision`
    );
    await queryRunner.query(
      `ALTER TABLE "task_events" ADD "recurrenceAnchorModeSnapshot" character varying NOT NULL DEFAULT 'planned'`
    );
    await queryRunner.query(`
      UPDATE "task_events" event
      SET
        "recurrenceIntervalSnapshot" = task."recurrenceInterval",
        "recurrenceAnchorModeSnapshot" = task."recurrenceAnchorMode"
      FROM "tasks" task
      WHERE task."id" = event."taskId"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "task_events" DROP COLUMN "recurrenceAnchorModeSnapshot"`
    );
    await queryRunner.query(
      `ALTER TABLE "task_events" DROP COLUMN "recurrenceIntervalSnapshot"`
    );
  }
}
