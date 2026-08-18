import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTaskFollowUps1774467800000 implements MigrationInterface {
  name = 'AddTaskFollowUps1774467800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tasks" ADD "followUpTaskId" uuid`);
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD "followUpDelayDays" integer`
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD "followUpSourceTaskId" uuid`
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_tasks_active_follow_up_source" ON "tasks" ("followUpSourceTaskId") WHERE "followUpSourceTaskId" IS NOT NULL AND "status" = 'active' AND "itemKind" = 'task'`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_tasks_active_follow_up_source"`);
    await queryRunner.query(
      `ALTER TABLE "tasks" DROP COLUMN "followUpSourceTaskId"`
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" DROP COLUMN "followUpDelayDays"`
    );
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "followUpTaskId"`);
  }
}
