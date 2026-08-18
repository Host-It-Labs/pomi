import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTaskEventLatestLookupIndex1774467600000 implements MigrationInterface {
  name = 'AddTaskEventLatestLookupIndex1774467600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_task_events_user_task_latest" ON "task_events" ("userId", "taskId", "occurredAt" DESC, "createdAt" DESC, "id" DESC)`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_task_events_user_task_latest"`);
  }
}
