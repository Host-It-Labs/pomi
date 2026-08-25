import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTaskDefaultViewPreference1774468200000 implements MigrationInterface {
  name = 'AddTaskDefaultViewPreference1774468200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "taskDefaultViewMode" character varying NOT NULL DEFAULT 'list'`
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "taskDefaultViewMode"`
    );
  }
}
