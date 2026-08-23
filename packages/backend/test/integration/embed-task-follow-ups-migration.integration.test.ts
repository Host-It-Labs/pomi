import { DataSource, QueryRunner } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EmbedTaskFollowUps1774468900000 } from '../../migrations/1774468900000-embedTaskFollowUps';

const hasDatabase = Boolean(process.env.DATABASE_URL);

const ids = {
  templateA: '10000000-0000-4000-8000-000000000001',
  templateB: '10000000-0000-4000-8000-000000000002',
  sourceA: '20000000-0000-4000-8000-000000000001',
  sourceB: '20000000-0000-4000-8000-000000000002',
  activeGenerated: '30000000-0000-4000-8000-000000000001',
  completedGenerated: '30000000-0000-4000-8000-000000000002',
  duplicateAfterFirstUp: '40000000-0000-4000-8000-000000000001',
  duplicateAfterSecondUp: '40000000-0000-4000-8000-000000000002',
};

type SourceRow = {
  id: string;
  followUpTaskId: string | null;
  followUpTaskIdBeforeEmbedding?: string;
  followUpDefinition?: Record<string, unknown>;
};

describe.runIf(hasDatabase)(
  'Embed Task follow-ups migration integration',
  () => {
    let dataSource: DataSource | undefined;
    let queryRunner: QueryRunner | undefined;

    beforeAll(async () => {
      dataSource = new DataSource({
        type: 'postgres',
        url: process.env.DATABASE_URL,
      });
      await dataSource.initialize();
      queryRunner = dataSource.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.query(`
      CREATE TEMPORARY TABLE "tasks" (
        "id" uuid PRIMARY KEY,
        "title" character varying NOT NULL,
        "description" text,
        "dueDate" date,
        "dueTime" character varying,
        "priority" character varying NOT NULL DEFAULT 'normal',
        "status" character varying NOT NULL DEFAULT 'active',
        "timerType" character varying NOT NULL DEFAULT 'work',
        "intentionSlug" character varying,
        "subIntentionSlug" character varying,
        "followUpTaskId" uuid,
        "followUpSourceTaskId" uuid,
        "itemKind" character varying NOT NULL DEFAULT 'task',
        "vacationEligible" boolean NOT NULL DEFAULT false
      )
    `);
      await queryRunner.query(
        `CREATE UNIQUE INDEX "UQ_tasks_active_follow_up_source" ON "tasks" ("followUpSourceTaskId") WHERE "followUpSourceTaskId" IS NOT NULL AND "status" = 'active' AND "itemKind" = 'task'`
      );
      await queryRunner.query(
        `CREATE INDEX "IDX_tasks_active_due_notification_scan" ON "tasks" ("dueDate", "dueTime") WHERE "status" = 'active' AND "dueDate" IS NOT NULL AND "itemKind" = 'task'`
      );
      await queryRunner.query(
        `
        INSERT INTO "tasks" (
          "id",
          "title",
          "description",
          "dueTime",
          "priority",
          "status",
          "timerType",
          "intentionSlug",
          "subIntentionSlug",
          "followUpTaskId",
          "followUpSourceTaskId",
          "itemKind",
          "vacationEligible"
        )
        VALUES
          ($1, 'Send shared recap', 'Use the shared recap details', '09:30', 'high', 'active', 'work', 'planning', 'handoff', NULL, NULL, 'task', true),
          ($2, 'Send shared recap', 'Use the shared recap details', '09:30', 'high', 'active', 'work', 'planning', 'handoff', NULL, NULL, 'task', true),
          ($3, 'Prepare first launch', NULL, NULL, 'normal', 'active', 'work', NULL, NULL, $1, NULL, 'task', false),
          ($4, 'Prepare second launch', NULL, NULL, 'normal', 'active', 'work', NULL, NULL, $2, NULL, 'task', false),
          ($5, 'Active generated recap', NULL, '10:00', 'normal', 'active', 'work', NULL, NULL, NULL, $3, 'task', false),
          ($6, 'Completed generated recap', NULL, '10:00', 'normal', 'completed', 'work', NULL, NULL, NULL, $3, 'task', false)
      `,
        [
          ids.templateA,
          ids.templateB,
          ids.sourceA,
          ids.sourceB,
          ids.activeGenerated,
          ids.completedGenerated,
        ]
      );
    });

    afterAll(async () => {
      await queryRunner?.release();
      if (dataSource?.isInitialized) await dataSource.destroy();
    });

    it('restores exact legacy links through down and re-embeds them without weakening generated follow-up indexes', async () => {
      const migration = new EmbedTaskFollowUps1774468900000();
      const runner = requireQueryRunner(queryRunner);

      await migration.up(runner);
      await expectEmbeddedState(runner);
      await expectGeneratedState(runner, 'followUp');
      await expectActiveFollowUpUniqueness(runner, ids.duplicateAfterFirstUp);

      await migration.down(runner);
      const restoredSources = (await runner.query(
        `
        SELECT "id", "followUpTaskId"
        FROM "tasks"
        WHERE "id" IN ($1, $2)
        ORDER BY "id"
      `,
        [ids.sourceA, ids.sourceB]
      )) as SourceRow[];
      expect(restoredSources).toEqual([
        { id: ids.sourceA, followUpTaskId: ids.templateA },
        { id: ids.sourceB, followUpTaskId: ids.templateB },
      ]);
      expect(await migrationOwnedColumns(runner)).toEqual([]);
      await expectGeneratedState(runner, 'task');
      expect(await activeFollowUpIndexPredicate(runner)).toContain("'task'");

      await migration.up(runner);
      await expectEmbeddedState(runner);
      await expectGeneratedState(runner, 'followUp');
      await expectActiveFollowUpUniqueness(runner, ids.duplicateAfterSecondUp);
    });
  }
);

function requireQueryRunner(queryRunner: QueryRunner | undefined): QueryRunner {
  if (!queryRunner) throw new Error('PostgreSQL query runner was not created');
  return queryRunner;
}

async function expectEmbeddedState(queryRunner: QueryRunner): Promise<void> {
  const sources = (await queryRunner.query(
    `
      SELECT
        "id",
        "followUpTaskId",
        "followUpTaskIdBeforeEmbedding",
        "followUpDefinition"
      FROM "tasks"
      WHERE "id" IN ($1, $2)
      ORDER BY "id"
    `,
    [ids.sourceA, ids.sourceB]
  )) as SourceRow[];
  const definition = {
    title: 'Send shared recap',
    description: 'Use the shared recap details',
    dueTime: '09:30',
    priority: 'high',
    timerType: 'work',
    intentionSlug: 'planning',
    subIntentionSlug: 'handoff',
    vacationEligible: true,
  };
  expect(sources).toEqual([
    {
      id: ids.sourceA,
      followUpTaskId: null,
      followUpTaskIdBeforeEmbedding: ids.templateA,
      followUpDefinition: definition,
    },
    {
      id: ids.sourceB,
      followUpTaskId: null,
      followUpTaskIdBeforeEmbedding: ids.templateB,
      followUpDefinition: definition,
    },
  ]);
  const templateKinds = await queryRunner.query(
    `SELECT "id", "itemKind" FROM "tasks" WHERE "id" IN ($1, $2) ORDER BY "id"`,
    [ids.templateA, ids.templateB]
  );
  expect(templateKinds).toEqual([
    { id: ids.templateA, itemKind: 'followUpTemplate' },
    { id: ids.templateB, itemKind: 'followUpTemplate' },
  ]);
  expect(await activeFollowUpIndexPredicate(queryRunner)).toContain(
    "'followUp'"
  );
}

async function expectGeneratedState(
  queryRunner: QueryRunner,
  expectedItemKind: string
): Promise<void> {
  const generatedRows = await queryRunner.query(
    `
      SELECT "id", "itemKind", "status", "followUpSourceTaskId"
      FROM "tasks"
      WHERE "id" IN ($1, $2)
      ORDER BY "id"
    `,
    [ids.activeGenerated, ids.completedGenerated]
  );
  expect(generatedRows).toEqual([
    {
      id: ids.activeGenerated,
      itemKind: expectedItemKind,
      status: 'active',
      followUpSourceTaskId: ids.sourceA,
    },
    {
      id: ids.completedGenerated,
      itemKind: expectedItemKind,
      status: 'completed',
      followUpSourceTaskId: ids.sourceA,
    },
  ]);
}

async function expectActiveFollowUpUniqueness(
  queryRunner: QueryRunner,
  duplicateId: string
): Promise<void> {
  let postgresCode: string | undefined;
  try {
    await queryRunner.query(
      `INSERT INTO "tasks" ("id", "title", "followUpSourceTaskId", "itemKind") VALUES ($1, 'Duplicate active follow-up', $2, 'followUp')`,
      [duplicateId, ids.sourceA]
    );
  } catch (error) {
    postgresCode = (error as { driverError?: { code?: string } }).driverError
      ?.code;
  }
  expect(postgresCode).toBe('23505');
}

async function activeFollowUpIndexPredicate(
  queryRunner: QueryRunner
): Promise<string> {
  const rows = (await queryRunner.query(
    `
      SELECT pg_get_expr(index_data.indpred, index_data.indrelid) AS "predicate"
      FROM pg_index AS index_data
      INNER JOIN pg_class AS index_relation
        ON index_relation.oid = index_data.indexrelid
      WHERE index_relation.relnamespace = pg_my_temp_schema()
        AND index_relation.relname = 'UQ_tasks_active_follow_up_source'
    `
  )) as { predicate: string }[];
  expect(rows).toHaveLength(1);
  return rows[0].predicate;
}

async function migrationOwnedColumns(
  queryRunner: QueryRunner
): Promise<string[]> {
  const rows = (await queryRunner.query(`
    SELECT attribute.attname AS "columnName"
    FROM pg_attribute AS attribute
    WHERE attribute.attrelid = 'tasks'::regclass
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
      AND attribute.attname IN (
        'followUpDefinition',
        'followUpTaskIdBeforeEmbedding'
      )
    ORDER BY attribute.attname
  `)) as { columnName: string }[];
  return rows.map(row => row.columnName);
}
