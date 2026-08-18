import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTaskVacationVisibilityPreference1774467950000 implements MigrationInterface {
  name = 'AddTaskVacationVisibilityPreference1774467950000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "tasksShowVacationCovered" boolean NOT NULL DEFAULT false`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "tasksShowVacationCovered"`
    );
  }
}
