import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddListsVacationAndDescriptions1774467000000 implements MigrationInterface {
  name = 'AddListsVacationAndDescriptions1774467000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "destinationDescriptionsEnabled" boolean NOT NULL DEFAULT false`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "listsExtension" boolean NOT NULL DEFAULT false`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "vacationExtension" boolean NOT NULL DEFAULT false`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "longBreakToBreakEnabled" boolean NOT NULL DEFAULT false`
    );
    await queryRunner.query(`ALTER TABLE "intentions" ADD "description" text`);
    await queryRunner.query(
      `ALTER TABLE "intentions" ADD "vacationDefault" boolean NOT NULL DEFAULT false`
    );
    await queryRunner.query(
      `CREATE TABLE "lists" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "title" character varying NOT NULL, "emoji" character varying, "description" text, "vacationDefault" boolean NOT NULL DEFAULT false, "isArchived" boolean NOT NULL DEFAULT false, "sourceIntentionId" uuid, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_lists_user_title" UNIQUE ("userId", "title"), CONSTRAINT "PK_lists" PRIMARY KEY ("id"), CONSTRAINT "FK_lists_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE)`
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD "itemKind" character varying NOT NULL DEFAULT 'task'`
    );
    await queryRunner.query(`ALTER TABLE "tasks" ADD "listId" uuid`);
    await queryRunner.query(`ALTER TABLE "tasks" ADD "taskRestoreState" jsonb`);
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD "vacationEligible" boolean NOT NULL DEFAULT false`
    );
    await queryRunner.query(`ALTER TABLE "tasks" ADD "lastVacationRunId" uuid`);
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD "lastVacationShiftedOn" date`
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD CONSTRAINT "FK_tasks_list" FOREIGN KEY ("listId") REFERENCES "lists"("id") ON DELETE CASCADE`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tasks_list_status" ON "tasks" ("listId", "status") WHERE "itemKind" = 'listItem'`
    );
    await queryRunner.query(
      `CREATE TABLE "vacation_states" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "active" boolean NOT NULL DEFAULT false, "runId" uuid, "startedOn" date, "endsOn" date, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_vacation_user" UNIQUE ("userId"), CONSTRAINT "PK_vacation_states" PRIMARY KEY ("id"), CONSTRAINT "FK_vacation_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE)`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "vacation_states"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_tasks_list_status"`);
    await queryRunner.query(
      `ALTER TABLE "tasks" DROP CONSTRAINT "FK_tasks_list"`
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" DROP COLUMN "lastVacationShiftedOn"`
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" DROP COLUMN "lastVacationRunId"`
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" DROP COLUMN "vacationEligible"`
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" DROP COLUMN "taskRestoreState"`
    );
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "listId"`);
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "itemKind"`);
    await queryRunner.query(`DROP TABLE "lists"`);
    await queryRunner.query(
      `ALTER TABLE "intentions" DROP COLUMN "vacationDefault"`
    );
    await queryRunner.query(
      `ALTER TABLE "intentions" DROP COLUMN "description"`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "longBreakToBreakEnabled"`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "vacationExtension"`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "listsExtension"`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "destinationDescriptionsEnabled"`
    );
  }
}
