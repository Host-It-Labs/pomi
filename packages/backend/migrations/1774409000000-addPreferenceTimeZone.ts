import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPreferenceTimeZone1774409000000 implements MigrationInterface {
  name = 'AddPreferenceTimeZone1774409000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "timeZone" character varying NOT NULL DEFAULT 'UTC'`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "preferences" DROP COLUMN "timeZone"`);
  }
}
