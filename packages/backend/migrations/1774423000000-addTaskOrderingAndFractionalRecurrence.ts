import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTaskOrderingAndFractionalRecurrence1774423000000 implements MigrationInterface {
  name = 'AddTaskOrderingAndFractionalRecurrence1774423000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD "manualOrderOverride" boolean NOT NULL DEFAULT false`
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD "recurrenceInterval" double precision`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tasks" DROP COLUMN "recurrenceInterval"`
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" DROP COLUMN "manualOrderOverride"`
    );
  }
}
