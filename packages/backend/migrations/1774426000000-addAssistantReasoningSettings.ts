import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAssistantReasoningSettings1774426000000 implements MigrationInterface {
  name = 'AddAssistantReasoningSettings1774426000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "assistant_settings" ADD "reasoningBaseEffort" character varying NOT NULL DEFAULT 'low'`
    );
    await queryRunner.query(
      `ALTER TABLE "assistant_settings" ADD "reasoningEscalatedEffort" character varying NOT NULL DEFAULT 'medium'`
    );
    await queryRunner.query(
      `ALTER TABLE "assistant_settings" ADD "reasoningAutoEscalationEnabled" boolean NOT NULL DEFAULT true`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "assistant_settings" DROP COLUMN "reasoningAutoEscalationEnabled"`
    );
    await queryRunner.query(
      `ALTER TABLE "assistant_settings" DROP COLUMN "reasoningEscalatedEffort"`
    );
    await queryRunner.query(
      `ALTER TABLE "assistant_settings" DROP COLUMN "reasoningBaseEffort"`
    );
  }
}
