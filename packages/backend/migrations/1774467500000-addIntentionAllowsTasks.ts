import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIntentionAllowsTasks1774467500000 implements MigrationInterface {
  name = 'AddIntentionAllowsTasks1774467500000';

  up(queryRunner: QueryRunner) {
    return queryRunner.query(
      `ALTER TABLE "intentions" ADD COLUMN IF NOT EXISTS "allowsTasks" boolean NOT NULL DEFAULT true`
    );
  }

  down(queryRunner: QueryRunner) {
    return queryRunner.query(
      `ALTER TABLE "intentions" DROP COLUMN IF EXISTS "allowsTasks"`
    );
  }
}
