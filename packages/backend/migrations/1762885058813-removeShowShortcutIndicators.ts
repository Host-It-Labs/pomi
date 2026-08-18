import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveShowShortcutIndicators1762885058813 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "showShortcutIndicators"`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "showShortcutIndicators" boolean NOT NULL DEFAULT false`
    );
  }
}
