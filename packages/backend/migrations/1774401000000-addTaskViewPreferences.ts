import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTaskViewPreferences1774401000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "tasksShowSetupPrompts" boolean NOT NULL DEFAULT true`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "tasksShowInMinimizedTimer" boolean NOT NULL DEFAULT false`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "tasksShowInMinimizedTimer"`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "tasksShowSetupPrompts"`
    );
  }
}
