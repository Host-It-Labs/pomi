import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSessionShowEta1773900000000 implements MigrationInterface {
  name = 'AddSessionShowEta1773900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "sessionShowEta" boolean NOT NULL DEFAULT false`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "sessionShowEta"`
    );
  }
}
