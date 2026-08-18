import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTaskIntentionLinks1774402000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD "intentionSlug" character varying`
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD "subIntentionSlug" character varying`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tasks_user_intention" ON "tasks" ("userId", "intentionSlug", "subIntentionSlug")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_tasks_user_intention"`);
    await queryRunner.query(
      `ALTER TABLE "tasks" DROP COLUMN "subIntentionSlug"`
    );
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "intentionSlug"`);
  }
}
