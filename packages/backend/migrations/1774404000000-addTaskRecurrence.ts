import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTaskRecurrence1774404000000 implements MigrationInterface {
  name = 'AddTaskRecurrence1774404000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD "recurrenceRule" character varying`
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD "recurrenceAnchorMode" character varying NOT NULL DEFAULT 'planned'`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tasks" DROP COLUMN "recurrenceAnchorMode"`
    );
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "recurrenceRule"`);
  }
}
