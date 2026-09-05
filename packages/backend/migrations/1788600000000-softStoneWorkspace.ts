import { MigrationInterface, QueryRunner } from 'typeorm';

export class SoftStoneWorkspace1788600000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "dismissedSettingSuggestions" jsonb NOT NULL DEFAULT '[]'::jsonb`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "tasksDuringBreaks"`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ALTER COLUMN "tasksExtension" SET DEFAULT true`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ALTER COLUMN "intentionExtension" SET DEFAULT true`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ALTER COLUMN "sessionsExtension" SET DEFAULT true`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ALTER COLUMN "listsExtension" SET DEFAULT true`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ALTER COLUMN "intentionCustomDurations" SET DEFAULT true`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ALTER COLUMN "intentionSubIntentions" SET DEFAULT true`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ALTER COLUMN "advancedSkip" SET DEFAULT true`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ALTER COLUMN "timerExtension" SET DEFAULT true`
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "tasksDuringBreaks" boolean NOT NULL DEFAULT true`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "dismissedSettingSuggestions"`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ALTER COLUMN "tasksExtension" SET DEFAULT false`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ALTER COLUMN "intentionExtension" SET DEFAULT false`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ALTER COLUMN "sessionsExtension" SET DEFAULT false`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ALTER COLUMN "listsExtension" SET DEFAULT false`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ALTER COLUMN "intentionCustomDurations" SET DEFAULT false`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ALTER COLUMN "intentionSubIntentions" SET DEFAULT false`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ALTER COLUMN "advancedSkip" SET DEFAULT false`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ALTER COLUMN "timerExtension" SET DEFAULT false`
    );
  }
}
