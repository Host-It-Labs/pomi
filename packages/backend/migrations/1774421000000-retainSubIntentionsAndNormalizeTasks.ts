import { MigrationInterface, QueryRunner } from 'typeorm';

export class RetainSubIntentionsAndNormalizeTasks1774421000000 implements MigrationInterface {
  name = 'RetainSubIntentionsAndNormalizeTasks1774421000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      WITH normalized_statistics AS (
        SELECT
          statistic."id",
          statistic."userId",
          statistic."type",
          statistic."subIntentions",
          COALESCE(
            NULLIF(statistic."intentions", ARRAY[]::text[]),
            CASE
              WHEN statistic."intention" IS NOT NULL
                AND statistic."intention" <> ''
              THEN ARRAY[statistic."intention"]::text[]
              ELSE ARRAY[]::text[]
            END
          ) AS "selectedIntentions"
        FROM "statistics" statistic
      ),
      invalid_parent_selections AS (
        SELECT normalized_statistics."id", parent."id" AS "parentId"
        FROM normalized_statistics
        INNER JOIN "intentions" parent
          ON parent."userId" = normalized_statistics."userId"
          AND parent."parentIntentionId" IS NULL
          AND parent."slug" = ANY(normalized_statistics."selectedIntentions")
          AND (
            (parent."type" = 'work' AND normalized_statistics."type" = 'work')
            OR (parent."type" = 'break' AND normalized_statistics."type" IN ('break', 'longBreak'))
            OR (parent."type" = 'longBreak' AND normalized_statistics."type" = 'longBreak')
          )
        WHERE EXISTS (
          SELECT 1
          FROM "intentions" child
          WHERE child."userId" = parent."userId"
            AND child."type" = parent."type"
            AND child."parentIntentionId" = parent."id"
            AND child."isArchived" = false
        )
          AND NULLIF(
            normalized_statistics."subIntentions" ->> parent."slug",
            ''
          ) IS NULL
      ),
      removed_parent_usage AS (
        SELECT "parentId", COUNT(*)::int AS "count"
        FROM invalid_parent_selections
        GROUP BY "parentId"
      )
      UPDATE "intentions" parent
      SET "usageCount" = GREATEST(0, parent."usageCount" - removed_parent_usage."count")
      FROM removed_parent_usage
      WHERE parent."id" = removed_parent_usage."parentId"
    `);

    await queryRunner.query(`
      WITH normalized_statistics AS (
        SELECT
          statistic."id",
          statistic."userId",
          statistic."type",
          statistic."subIntentions",
          COALESCE(
            NULLIF(statistic."intentions", ARRAY[]::text[]),
            CASE
              WHEN statistic."intention" IS NOT NULL
                AND statistic."intention" <> ''
              THEN ARRAY[statistic."intention"]::text[]
              ELSE ARRAY[]::text[]
            END
          ) AS "selectedIntentions"
        FROM "statistics" statistic
      ),
      invalid_parent_selections AS (
        SELECT normalized_statistics."id", parent."slug"
        FROM normalized_statistics
        INNER JOIN "intentions" parent
          ON parent."userId" = normalized_statistics."userId"
          AND parent."parentIntentionId" IS NULL
          AND parent."slug" = ANY(normalized_statistics."selectedIntentions")
          AND (
            (parent."type" = 'work' AND normalized_statistics."type" = 'work')
            OR (parent."type" = 'break' AND normalized_statistics."type" IN ('break', 'longBreak'))
            OR (parent."type" = 'longBreak' AND normalized_statistics."type" = 'longBreak')
          )
        WHERE EXISTS (
          SELECT 1
          FROM "intentions" child
          WHERE child."userId" = parent."userId"
            AND child."type" = parent."type"
            AND child."parentIntentionId" = parent."id"
            AND child."isArchived" = false
        )
          AND NULLIF(
            normalized_statistics."subIntentions" ->> parent."slug",
            ''
          ) IS NULL
      ),
      cleaned_statistics AS (
        SELECT
          normalized_statistics."id",
          ARRAY(
            SELECT selection.slug
            FROM unnest(normalized_statistics."selectedIntentions")
              WITH ORDINALITY AS selection(slug, position)
            WHERE NOT EXISTS (
              SELECT 1
              FROM invalid_parent_selections invalid_selection
              WHERE invalid_selection."id" = normalized_statistics."id"
                AND invalid_selection."slug" = selection.slug
            )
            ORDER BY selection.position
          ) AS "nextIntentions"
        FROM normalized_statistics
        WHERE EXISTS (
          SELECT 1
          FROM invalid_parent_selections invalid_selection
          WHERE invalid_selection."id" = normalized_statistics."id"
        )
      )
      DELETE FROM "statistics" statistic
      USING cleaned_statistics
      WHERE statistic."id" = cleaned_statistics."id"
        AND cardinality(cleaned_statistics."nextIntentions") = 0
    `);

    await queryRunner.query(`
      WITH normalized_statistics AS (
        SELECT
          statistic."id",
          statistic."userId",
          statistic."type",
          statistic."subIntentions",
          COALESCE(
            NULLIF(statistic."intentions", ARRAY[]::text[]),
            CASE
              WHEN statistic."intention" IS NOT NULL
                AND statistic."intention" <> ''
              THEN ARRAY[statistic."intention"]::text[]
              ELSE ARRAY[]::text[]
            END
          ) AS "selectedIntentions"
        FROM "statistics" statistic
      ),
      invalid_parent_selections AS (
        SELECT normalized_statistics."id", parent."slug"
        FROM normalized_statistics
        INNER JOIN "intentions" parent
          ON parent."userId" = normalized_statistics."userId"
          AND parent."parentIntentionId" IS NULL
          AND parent."slug" = ANY(normalized_statistics."selectedIntentions")
          AND (
            (parent."type" = 'work' AND normalized_statistics."type" = 'work')
            OR (parent."type" = 'break' AND normalized_statistics."type" IN ('break', 'longBreak'))
            OR (parent."type" = 'longBreak' AND normalized_statistics."type" = 'longBreak')
          )
        WHERE EXISTS (
          SELECT 1
          FROM "intentions" child
          WHERE child."userId" = parent."userId"
            AND child."type" = parent."type"
            AND child."parentIntentionId" = parent."id"
            AND child."isArchived" = false
        )
          AND NULLIF(
            normalized_statistics."subIntentions" ->> parent."slug",
            ''
          ) IS NULL
      ),
      cleaned_statistics AS (
        SELECT
          normalized_statistics."id",
          ARRAY(
            SELECT selection.slug
            FROM unnest(normalized_statistics."selectedIntentions")
              WITH ORDINALITY AS selection(slug, position)
            WHERE NOT EXISTS (
              SELECT 1
              FROM invalid_parent_selections invalid_selection
              WHERE invalid_selection."id" = normalized_statistics."id"
                AND invalid_selection."slug" = selection.slug
            )
            ORDER BY selection.position
          ) AS "nextIntentions"
        FROM normalized_statistics
        WHERE EXISTS (
          SELECT 1
          FROM invalid_parent_selections invalid_selection
          WHERE invalid_selection."id" = normalized_statistics."id"
        )
      )
      UPDATE "statistics" statistic
      SET
        "intentions" = cleaned_statistics."nextIntentions",
        "intention" = cleaned_statistics."nextIntentions"[1],
        "subIntentions" = (
          SELECT NULLIF(jsonb_object_agg(entry.key, entry.value), '{}'::jsonb)
          FROM jsonb_each(
            COALESCE(statistic."subIntentions", '{}'::jsonb)
          ) AS entry(key, value)
          WHERE entry.key = ANY(cleaned_statistics."nextIntentions")
        )
      FROM cleaned_statistics
      WHERE statistic."id" = cleaned_statistics."id"
        AND cardinality(cleaned_statistics."nextIntentions") > 0
    `);

    await queryRunner.query(`
      UPDATE "tasks" task
      SET "intentionSlug" = (
        SELECT work_intention."slug"
        FROM "intentions" work_intention
        WHERE work_intention."userId" = task."userId"
          AND work_intention."type" = 'work'
          AND work_intention."slug" = task."intentionSlug"
        LIMIT 1
      )
      WHERE task."timerType" <> 'work'
    `);

    await queryRunner.query(`
      UPDATE "tasks" task
      SET "subIntentionSlug" = (
        SELECT work_child."slug"
        FROM "intentions" work_child
        INNER JOIN "intentions" work_parent
          ON work_parent."id" = work_child."parentIntentionId"
        WHERE work_child."userId" = task."userId"
          AND work_child."type" = 'work'
          AND work_child."slug" = task."subIntentionSlug"
          AND work_parent."slug" = task."intentionSlug"
        LIMIT 1
      )
      WHERE task."timerType" <> 'work'
        AND task."subIntentionSlug" IS NOT NULL
    `);

    await queryRunner.query(`
      UPDATE "task_events" event
      SET "intentionSlugSnapshot" = (
        SELECT work_intention."slug"
        FROM "intentions" work_intention
        WHERE work_intention."userId" = event."userId"
          AND work_intention."type" = 'work'
          AND work_intention."slug" = event."intentionSlugSnapshot"
        LIMIT 1
      )
      WHERE event."timerTypeSnapshot" <> 'work'
    `);

    await queryRunner.query(`
      UPDATE "task_events" event
      SET "subIntentionSlugSnapshot" = (
        SELECT work_child."slug"
        FROM "intentions" work_child
        INNER JOIN "intentions" work_parent
          ON work_parent."id" = work_child."parentIntentionId"
        WHERE work_child."userId" = event."userId"
          AND work_child."type" = 'work'
          AND work_child."slug" = event."subIntentionSlugSnapshot"
          AND work_parent."slug" = event."intentionSlugSnapshot"
        LIMIT 1
      )
      WHERE event."timerTypeSnapshot" <> 'work'
        AND event."subIntentionSlugSnapshot" IS NOT NULL
    `);

    await queryRunner.query(`
      UPDATE "tasks" task
      SET
        "intentionSlug" = NULL,
        "subIntentionSlug" = NULL
      WHERE task."intentionSlug" IS NOT NULL
        AND task."subIntentionSlug" IS NULL
        AND EXISTS (
          SELECT 1
          FROM "intentions" parent
          INNER JOIN "intentions" child
            ON child."parentIntentionId" = parent."id"
          WHERE parent."userId" = task."userId"
            AND parent."type" = 'work'
            AND parent."parentIntentionId" IS NULL
            AND parent."slug" = task."intentionSlug"
            AND child."isArchived" = false
        )
    `);

    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "timerType"`);
    await queryRunner.query(
      `ALTER TABLE "task_events" DROP COLUMN "timerTypeSnapshot"`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "tasksBreakTasks"`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "tasksShowBreakTasksDuringWork"`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "tasksHideDuringBreaks"`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "tasksHideDuringBreaks" boolean NOT NULL DEFAULT false`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "tasksShowBreakTasksDuringWork" boolean NOT NULL DEFAULT false`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "tasksBreakTasks" boolean NOT NULL DEFAULT false`
    );
    await queryRunner.query(
      `ALTER TABLE "task_events" ADD "timerTypeSnapshot" character varying NOT NULL DEFAULT 'work'`
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD "timerType" character varying NOT NULL DEFAULT 'work'`
    );
  }
}
