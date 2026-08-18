import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddShowShortcutIndicators1749158400000 implements MigrationInterface {
  name = 'AddShowShortcutIndicators1749158400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "showShortcutIndicators" boolean NOT NULL DEFAULT false`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "showShortcutIndicators"`
    );
  }
}
