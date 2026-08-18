import { MigrationInterface, QueryRunner } from 'typeorm';

export class MakeTaskDueDateNullable1774407000000 implements MigrationInterface {
  name = 'MakeTaskDueDateNullable1774407000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tasks" ALTER COLUMN "dueDate" DROP NOT NULL`
    );
    await queryRunner.query(
      `ALTER TABLE "task_events" ALTER COLUMN "dueDate" DROP NOT NULL`
    );
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {}
}
