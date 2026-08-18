import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLanguagePreference1774467900000 implements MigrationInterface {
  name = 'AddLanguagePreference1774467900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "language" character varying(16)`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ALTER COLUMN "language" SET DEFAULT 'en'`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "preferences" DROP COLUMN "language"`);
  }
}
