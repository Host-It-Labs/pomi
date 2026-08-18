import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIntentionIsArchived1767200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "intentions" ADD "isArchived" boolean NOT NULL DEFAULT false`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "intentions" DROP COLUMN "isArchived"`
    );
  }
}
