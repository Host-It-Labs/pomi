import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTaskDefaultSortPreference1774468000000 implements MigrationInterface {
  name = 'AddTaskDefaultSortPreference1774468000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "taskDefaultSortMode" character varying NOT NULL DEFAULT 'default'`
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "taskDefaultSortMode"`
    );
  }
}
