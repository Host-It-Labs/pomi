import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTaskRecurrenceSequenceIndex1774424000000 implements MigrationInterface {
  name = 'AddTaskRecurrenceSequenceIndex1774424000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD "recurrenceSequenceIndex" integer NOT NULL DEFAULT 0`
    );
    await queryRunner.query(
      `ALTER TABLE "task_events" ADD "recurrenceSequenceIndex" integer NOT NULL DEFAULT 0`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "task_events" DROP COLUMN "recurrenceSequenceIndex"`
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" DROP COLUMN "recurrenceSequenceIndex"`
    );
  }
}
