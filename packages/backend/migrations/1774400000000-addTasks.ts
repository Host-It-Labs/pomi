import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTasks1774400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "tasksExtension" boolean NOT NULL DEFAULT false`
    );
    await queryRunner.query(
      `CREATE TABLE "tasks" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "title" character varying NOT NULL, "dueDate" date, "priority" character varying NOT NULL DEFAULT 'normal', "status" character varying NOT NULL DEFAULT 'active', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_tasks_id" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tasks_user_status_due" ON "tasks" ("userId", "status", "dueDate")`
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD CONSTRAINT "FK_tasks_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tasks" DROP CONSTRAINT "FK_tasks_user"`
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_tasks_user_status_due"`);
    await queryRunner.query(`DROP TABLE "tasks"`);
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "tasksExtension"`
    );
  }
}
