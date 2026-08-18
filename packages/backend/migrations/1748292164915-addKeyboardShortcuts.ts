import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddKeyboardShortcuts1748292164915 implements MigrationInterface {
  name = 'AddKeyboardShortcuts1748292164915';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "enableGlobalShortcut" boolean NOT NULL DEFAULT false`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "enableKeyboardShortcuts" boolean NOT NULL DEFAULT true`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "enableKeyboardShortcuts"`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "enableGlobalShortcut"`
    );
  }
}
