import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSessionAutoDetectLongBreak1764100000000 implements MigrationInterface {
  name = 'AddSessionAutoDetectLongBreak1764100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "sessionAutoDetectLongBreak" boolean NOT NULL DEFAULT false`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "sessionAutoDetectLongBreak"`
    );
  }
}
