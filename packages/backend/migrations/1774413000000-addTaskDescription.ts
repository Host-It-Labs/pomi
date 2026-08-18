import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTaskDescription1774413000000 implements MigrationInterface {
  name = 'AddTaskDescription1774413000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tasks" ADD "description" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "description"`);
  }
}
