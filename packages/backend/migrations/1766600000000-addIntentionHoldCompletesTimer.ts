import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIntentionHoldCompletesTimer1766600000000 implements MigrationInterface {
  name = 'AddIntentionHoldCompletesTimer1766600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "intentionHoldCompletesTimer" boolean NOT NULL DEFAULT false`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "intentionHoldCompletesTimer"`
    );
  }
}
