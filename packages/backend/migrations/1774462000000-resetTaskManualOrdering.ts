import { MigrationInterface, QueryRunner } from 'typeorm';

export class ResetTaskManualOrdering1774462000000 implements MigrationInterface {
  name = 'ResetTaskManualOrdering1774462000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "tasks" SET "manualOrder" = NULL, "manualOrderOverride" = false WHERE "manualOrder" IS NOT NULL OR "manualOrderOverride" = true`
    );
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {}
}
