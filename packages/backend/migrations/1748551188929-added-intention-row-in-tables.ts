import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddedIntentionRowInTables1748551188929 implements MigrationInterface {
  name = 'AddedIntentionRowInTables1748551188929';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "statistics" ADD "intention" character varying`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "intentionExtension" boolean NOT NULL DEFAULT false`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "intentionExtension"`
    );
    await queryRunner.query(`ALTER TABLE "statistics" DROP COLUMN "intention"`);
  }
}
