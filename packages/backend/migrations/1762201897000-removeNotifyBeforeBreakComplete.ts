import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveNotifyBeforeBreakComplete1762201897000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "notifyBeforeBreakComplete"`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "notifyBeforeBreakComplete" boolean NOT NULL DEFAULT true`
    );
  }
}
