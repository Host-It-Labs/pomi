import { MigrationInterface, QueryRunner } from 'typeorm';

export class ReintroduceTaskTimerTypesAndPins1774425000000 implements MigrationInterface {
  name = 'ReintroduceTaskTimerTypesAndPins1774425000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD "timerType" character varying NOT NULL DEFAULT 'work'`
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD "pinnedAt" TIMESTAMP NULL`
    );
    await queryRunner.query(
      `ALTER TABLE "task_events" ADD "timerTypeSnapshot" character varying NOT NULL DEFAULT 'work'`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "tasksDuringBreaks" boolean NOT NULL DEFAULT false`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "taskDefaultDueDateMode" character varying NOT NULL DEFAULT 'tomorrow'`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "taskDefaultDueDateDays" integer NOT NULL DEFAULT 1`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "taskDefaultDueDateDays"`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "taskDefaultDueDateMode"`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "tasksDuringBreaks"`
    );
    await queryRunner.query(
      `ALTER TABLE "task_events" DROP COLUMN "timerTypeSnapshot"`
    );
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "pinnedAt"`);
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "timerType"`);
  }
}
