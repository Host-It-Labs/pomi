import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLiveActivityToken1788230400000 implements MigrationInterface {
  name = 'AddLiveActivityToken1788230400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "liveActivityToken" character varying`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "liveActivityToken"`
    );
  }
}
