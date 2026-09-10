import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTaskListChangeFeed1788997300000 implements MigrationInterface {
  name = 'AddTaskListChangeFeed1788997300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "task_list_revision_counters" (
        "userId" uuid PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
        "revision" bigint NOT NULL DEFAULT 0
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "task_list_changes" (
        "userId" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "revision" bigint NOT NULL,
        "entityType" varchar NOT NULL,
        "entityId" uuid NOT NULL,
        "operation" varchar NOT NULL,
        "payload" jsonb,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_task_list_changes" PRIMARY KEY ("userId", "revision")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_task_list_changes_created_at"
      ON "task_list_changes" ("createdAt")
    `);
    await queryRunner.query(`
      CREATE FUNCTION record_task_list_change() RETURNS trigger AS $$
      DECLARE
        changed_row record;
        next_revision bigint;
        change_payload jsonb;
        old_domain jsonb;
        new_domain jsonb;
        entity_type varchar;
        changed_item_kind varchar;
      BEGIN
        changed_row := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
        entity_type := TG_ARGV[0];
        IF TG_ARGV[0] = 'task' THEN
          changed_item_kind := CASE
            WHEN TG_OP = 'DELETE' THEN OLD."itemKind"
            ELSE NEW."itemKind"
          END;
          IF changed_item_kind = 'listItem' THEN
            entity_type := 'listItem';
          END IF;
        END IF;
        IF TG_ARGV[0] = 'task' AND TG_OP = 'UPDATE' THEN
          old_domain := to_jsonb(OLD) - ARRAY[
            'updatedAt', 'lastReminderKey', 'nextReminderAt',
            'reminderClaimToken', 'reminderClaimedUntil', 'lastUrgentReminderAt'
          ];
          new_domain := to_jsonb(NEW) - ARRAY[
            'updatedAt', 'lastReminderKey', 'nextReminderAt',
            'reminderClaimToken', 'reminderClaimedUntil', 'lastUrgentReminderAt'
          ];
          IF old_domain = new_domain THEN
            RETURN changed_row;
          END IF;
        END IF;
        INSERT INTO "task_list_revision_counters" ("userId", "revision")
        VALUES (changed_row."userId", 1)
        ON CONFLICT ("userId") DO UPDATE
        SET "revision" = "task_list_revision_counters"."revision" + 1
        RETURNING "revision" INTO next_revision;

        change_payload := CASE
          WHEN TG_OP = 'DELETE' THEN NULL
          ELSE to_jsonb(NEW)
            - 'user'
            - 'lastReminderKey'
            - 'nextReminderAt'
            - 'reminderClaimToken'
            - 'reminderClaimedUntil'
            - 'lastUrgentReminderAt'
        END;
        IF TG_ARGV[0] = 'task' AND TG_OP <> 'DELETE' THEN
          change_payload := change_payload
            - 'recurrenceSequenceIndex'
            - 'taskRestoreState'
            - 'lastVacationRunId'
            - 'lastVacationShiftedOn';
          IF changed_item_kind <> 'listItem' THEN
            change_payload := jsonb_set(change_payload, '{itemKind}', '"task"');
            change_payload := jsonb_set(change_payload, '{followUpTaskId}', 'null');
          END IF;
        END IF;
        INSERT INTO "task_list_changes" (
          "userId", "revision", "entityType", "entityId", "operation", "payload"
        ) VALUES (
          changed_row."userId",
          next_revision,
          entity_type,
          changed_row."id",
          CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'upsert' END,
          change_payload
        );
        RETURN changed_row;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TR_tasks_change_feed"
      AFTER INSERT OR UPDATE OR DELETE ON "tasks"
      FOR EACH ROW EXECUTE FUNCTION record_task_list_change('task')
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TR_lists_change_feed"
      AFTER INSERT OR UPDATE OR DELETE ON "lists"
      FOR EACH ROW EXECUTE FUNCTION record_task_list_change('list')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER "TR_lists_change_feed" ON "lists"`);
    await queryRunner.query(`DROP TRIGGER "TR_tasks_change_feed" ON "tasks"`);
    await queryRunner.query(`DROP FUNCTION record_task_list_change`);
    await queryRunner.query(`DROP INDEX "IDX_task_list_changes_created_at"`);
    await queryRunner.query(`DROP TABLE "task_list_changes"`);
    await queryRunner.query(`DROP TABLE "task_list_revision_counters"`);
  }
}
