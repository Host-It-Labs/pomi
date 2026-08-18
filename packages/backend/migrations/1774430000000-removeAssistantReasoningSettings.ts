import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveAssistantReasoningSettings1774430000000 implements MigrationInterface {
  name = 'RemoveAssistantReasoningSettings1774430000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
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

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "assistant_settings" ADD "reasoningBaseEffort" character varying NOT NULL DEFAULT 'minimal'`
    );
    await queryRunner.query(
      `ALTER TABLE "assistant_settings" ADD "reasoningEscalatedEffort" character varying NOT NULL DEFAULT 'medium'`
    );
    await queryRunner.query(
      `ALTER TABLE "assistant_settings" ADD "reasoningAutoEscalationEnabled" boolean NOT NULL DEFAULT true`
    );
  }
}
