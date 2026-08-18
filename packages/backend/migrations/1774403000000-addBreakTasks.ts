import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBreakTasks1774403000000 implements MigrationInterface {
  name = 'AddBreakTasks1774403000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD "timerType" character varying NOT NULL DEFAULT 'work'`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "tasksBreakTasks" boolean NOT NULL DEFAULT false`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "tasksShowBreakTasksDuringWork" boolean NOT NULL DEFAULT true`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "tasksShowBreakTasksDuringWork"`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "tasksBreakTasks"`
    );
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "timerType"`);
  }
}
