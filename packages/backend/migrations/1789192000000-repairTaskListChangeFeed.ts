import { MigrationInterface, QueryRunner } from 'typeorm';

export class RepairTaskListChangeFeed1789192000000 implements MigrationInterface {
  name = 'RepairTaskListChangeFeed1789192000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION record_task_list_change() RETURNS trigger AS $$
      DECLARE
        changed_row record;
        changed_user_id uuid;
        changed_entity_id uuid;
        next_revision bigint;
        old_revision bigint;
        change_payload jsonb;
        old_domain jsonb;
        new_domain jsonb;
        entity_type varchar;
        old_entity_type varchar;
        changed_item_kind varchar;
      BEGIN
        changed_row := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
        IF TG_OP = 'DELETE' THEN
          changed_user_id := OLD."userId";
          changed_entity_id := OLD."id";
        ELSE
          changed_user_id := NEW."userId";
          changed_entity_id := NEW."id";
        END IF;
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

        IF NOT EXISTS (
          SELECT 1 FROM "users" WHERE "id" = changed_user_id
        ) THEN
          RETURN changed_row;
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
          IF OLD."itemKind" IS DISTINCT FROM NEW."itemKind" THEN
            old_entity_type := CASE
              WHEN OLD."itemKind" = 'listItem' THEN 'listItem'
              ELSE 'task'
            END;
            INSERT INTO "task_list_revision_counters" ("userId", "revision")
            VALUES (changed_user_id, 1)
            ON CONFLICT ("userId") DO UPDATE
            SET "revision" = "task_list_revision_counters"."revision" + 1
            RETURNING "revision" INTO old_revision;
            INSERT INTO "task_list_changes" (
              "userId", "revision", "entityType", "entityId", "operation", "payload"
            ) VALUES (
              changed_user_id, old_revision, old_entity_type,
              OLD."id", 'delete', NULL
            );
          END IF;
        END IF;
        INSERT INTO "task_list_revision_counters" ("userId", "revision")
        VALUES (changed_user_id, 1)
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
          changed_user_id,
          next_revision,
          entity_type,
          changed_entity_id,
          CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'upsert' END,
          change_payload
        );
        DELETE FROM "task_list_changes"
        WHERE "userId" = changed_user_id
          AND "revision" <= next_revision - 2000;
        RETURN changed_row;
      END;
      $$ LANGUAGE plpgsql
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION record_task_list_change() RETURNS trigger AS $$
      DECLARE
        changed_row record;
        next_revision bigint;
        old_revision bigint;
        change_payload jsonb;
        old_domain jsonb;
        new_domain jsonb;
        entity_type varchar;
        old_entity_type varchar;
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

        IF NOT EXISTS (
          SELECT 1 FROM "users" WHERE "id" = changed_row."userId"
        ) THEN
          RETURN changed_row;
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
          IF OLD."itemKind" IS DISTINCT FROM NEW."itemKind" THEN
            old_entity_type := CASE
              WHEN OLD."itemKind" = 'listItem' THEN 'listItem'
              ELSE 'task'
            END;
            INSERT INTO "task_list_revision_counters" ("userId", "revision")
            VALUES (changed_row."userId", 1)
            ON CONFLICT ("userId") DO UPDATE
            SET "revision" = "task_list_revision_counters"."revision" + 1
            RETURNING "revision" INTO old_revision;
            INSERT INTO "task_list_changes" (
              "userId", "revision", "entityType", "entityId", "operation", "payload"
            ) VALUES (
              changed_row."userId", old_revision, old_entity_type,
              OLD."id", 'delete', NULL
            );
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
        DELETE FROM "task_list_changes"
        WHERE "userId" = changed_row."userId"
          AND "revision" <= next_revision - 2000;
        RETURN changed_row;
      END;
      $$ LANGUAGE plpgsql
    `);
  }
}
