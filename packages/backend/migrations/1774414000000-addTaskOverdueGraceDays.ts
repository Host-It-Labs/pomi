import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTaskOverdueGraceDays1774414000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "taskOverdueGraceDays" integer NOT NULL DEFAULT 1`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "taskOverdueGraceDays"`
    );
  }
}
