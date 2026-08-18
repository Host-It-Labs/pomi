import { MigrationInterface, QueryRunner } from 'typeorm';

export class RefineAssistantDebugLogs1774422000000 implements MigrationInterface {
  name = 'RefineAssistantDebugLogs1774422000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "assistant_debug_logs" ADD "source" character varying`
    );
    await queryRunner.query(
      `ALTER TABLE "assistant_debug_logs" ADD "status" character varying`
    );
    await queryRunner.query(
      `ALTER TABLE "assistant_debug_logs" ADD "processedOutput" jsonb`
    );
    await queryRunner.query(
      `ALTER TABLE "assistant_debug_logs" ADD "invalidParserOutput" text`
    );
    await queryRunner.query(
      `ALTER TABLE "assistant_debug_logs" ADD "resolutionNotes" jsonb NOT NULL DEFAULT '[]'::jsonb`
    );
    await queryRunner.query(
      `ALTER TABLE "assistant_debug_logs" ADD "timings" jsonb NOT NULL DEFAULT '{}'::jsonb`
    );
    await queryRunner.query(`
      UPDATE "assistant_debug_logs"
      SET
        "source" = CASE
          WHEN "kind" = 'taskDictation' THEN 'dictation'
          WHEN "kind" = 'voiceCommand' THEN 'assistantVoice'
          ELSE 'typed'
        END,
        "status" = CASE
          WHEN "error" IS NOT NULL THEN 'failed'
          WHEN "kind" = 'taskDictation' THEN 'dictated'
          ELSE 'succeeded'
        END,
        "kind" = CASE
          WHEN "kind" = 'taskDictation' THEN 'taskCapture'
          ELSE "kind"
        END
    `);
    await queryRunner.query(
      `ALTER TABLE "assistant_debug_logs" ALTER COLUMN "source" SET NOT NULL`
    );
    await queryRunner.query(
      `ALTER TABLE "assistant_debug_logs" ALTER COLUMN "status" SET NOT NULL`
    );
    await queryRunner.query(
      `ALTER TABLE "assistant_debug_logs" DROP COLUMN "audioBase64"`
    );
    await queryRunner.query(
      `ALTER TABLE "assistant_debug_logs" DROP COLUMN "audioMimeType"`
    );
    await queryRunner.query(
      `ALTER TABLE "assistant_debug_logs" DROP COLUMN "transcriptionOutput"`
    );
    await queryRunner.query(
      `ALTER TABLE "assistant_debug_logs" DROP COLUMN "parserOutput"`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "assistant_debug_logs" ADD "audioBase64" text`
    );
    await queryRunner.query(
      `ALTER TABLE "assistant_debug_logs" ADD "audioMimeType" character varying`
    );
    await queryRunner.query(
      `ALTER TABLE "assistant_debug_logs" ADD "transcriptionOutput" text`
    );
    await queryRunner.query(
      `ALTER TABLE "assistant_debug_logs" ADD "parserOutput" text`
    );
    await queryRunner.query(`
      UPDATE "assistant_debug_logs"
      SET "kind" = 'taskDictation'
      WHERE "source" = 'dictation' AND "status" = 'dictated'
    `);
    await queryRunner.query(
      `ALTER TABLE "assistant_debug_logs" DROP COLUMN "timings"`
    );
    await queryRunner.query(
      `ALTER TABLE "assistant_debug_logs" DROP COLUMN "resolutionNotes"`
    );
    await queryRunner.query(
      `ALTER TABLE "assistant_debug_logs" DROP COLUMN "invalidParserOutput"`
    );
    await queryRunner.query(
      `ALTER TABLE "assistant_debug_logs" DROP COLUMN "processedOutput"`
    );
    await queryRunner.query(
      `ALTER TABLE "assistant_debug_logs" DROP COLUMN "status"`
    );
    await queryRunner.query(
      `ALTER TABLE "assistant_debug_logs" DROP COLUMN "source"`
    );
  }
}
