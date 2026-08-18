import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveIntentionHoldCompletesTimer1773784218120 implements MigrationInterface {
  name = 'RemoveIntentionHoldCompletesTimer1773784218120';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "preferences" DROP COLUMN "intentionHoldCompletesTimer"'
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "preferences" ADD "intentionHoldCompletesTimer" boolean NOT NULL DEFAULT false'
    );
  }
}
