import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAssistantRecordingLimit1774427000000 implements MigrationInterface {
  name = 'AddAssistantRecordingLimit1774427000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "assistant_settings" ADD "assistantRecordingMaxMinutes" integer DEFAULT 10`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "assistant_settings" DROP COLUMN "assistantRecordingMaxMinutes"`
    );
  }
}
