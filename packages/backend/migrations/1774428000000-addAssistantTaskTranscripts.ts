import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAssistantTaskTranscripts1774428000000 implements MigrationInterface {
  name = 'AddAssistantTaskTranscripts1774428000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tasks" ADD "sourceTranscript" text`);
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "assistantTaskTranscriptsEnabled" boolean NOT NULL DEFAULT false`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "assistantTaskTranscriptMinWords" integer NOT NULL DEFAULT 15`
    );
    await queryRunner.query(
      `ALTER TABLE "assistant_settings" ALTER COLUMN "reasoningBaseEffort" SET DEFAULT 'minimal'`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "assistant_settings" ALTER COLUMN "reasoningBaseEffort" SET DEFAULT 'low'`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "assistantTaskTranscriptMinWords"`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "assistantTaskTranscriptsEnabled"`
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" DROP COLUMN "sourceTranscript"`
    );
  }
}
