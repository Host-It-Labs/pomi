import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPushTokens1761490000000 implements MigrationInterface {
  name = 'AddPushTokens1761490000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "fcmToken" character varying`
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "apnToken" character varying`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "apnToken"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "fcmToken"`);
  }
}
