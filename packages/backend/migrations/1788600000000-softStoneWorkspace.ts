import { MigrationInterface, QueryRunner } from 'typeorm';

export class SoftStoneWorkspace1788600000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "dismissedSettingSuggestions" jsonb NOT NULL DEFAULT '[]'::jsonb`
    );
    await queryRunner.query(`
      CREATE TABLE "retired_task_break_preferences" (
        "preferenceId" uuid PRIMARY KEY REFERENCES "preferences"("id") ON DELETE CASCADE,
        "tasksDuringBreaks" boolean NOT NULL
      )
    `);
    await queryRunner.query(`
      INSERT INTO "retired_task_break_preferences" ("preferenceId", "tasksDuringBreaks")
      SELECT "id", "tasksDuringBreaks" FROM "preferences"
    `);
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
    await queryRunner.query(`
      UPDATE "preferences" AS preference
      SET "tasksDuringBreaks" = previous."tasksDuringBreaks"
      FROM "retired_task_break_preferences" AS previous
      WHERE preference."id" = previous."preferenceId"
    `);
    await queryRunner.query(`DROP TABLE "retired_task_break_preferences"`);
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
