import { MigrationInterface, QueryRunner } from 'typeorm';

export class ChangeNameOfKeyboardShortcutPreferences1748682651237 implements MigrationInterface {
  name = 'ChangeNameOfKeyboardShortcutPreferences1748682651237';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "enableGlobalShortcut"`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "enableKeyboardShortcuts"`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "globalShortcut" boolean NOT NULL DEFAULT false`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "keyboardShortcuts" boolean NOT NULL DEFAULT true`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "keyboardShortcuts"`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "globalShortcut"`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "enableKeyboardShortcuts" boolean NOT NULL DEFAULT true`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "enableGlobalShortcut" boolean NOT NULL DEFAULT false`
    );
  }
}
