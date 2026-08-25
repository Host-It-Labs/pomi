import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveTaskDefaultViewPreference1774468300000 implements MigrationInterface {
  name = 'RemoveTaskDefaultViewPreference1774468300000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN IF EXISTS "taskDefaultViewMode"`
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "taskDefaultViewMode" character varying NOT NULL DEFAULT 'list'`
    );
  }
}
