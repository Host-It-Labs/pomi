import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTaskCustomDuration1774469100000 implements MigrationInterface {
  name = 'AddTaskCustomDuration1774469100000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tasks" ADD "customDuration" integer`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "customDuration"`);
  }
}
