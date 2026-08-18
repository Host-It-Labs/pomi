import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUndoAlerts1774200000000 implements MigrationInterface {
  name = 'AddUndoAlerts1774200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "undoAlerts" boolean NOT NULL DEFAULT false`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "undoAlerts"`
    );
  }
}
