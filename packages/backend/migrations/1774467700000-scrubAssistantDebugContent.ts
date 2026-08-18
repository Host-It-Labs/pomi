import { MigrationInterface, QueryRunner } from 'typeorm';

export class ScrubAssistantDebugContent1774467700000 implements MigrationInterface {
  name = 'ScrubAssistantDebugContent1774467700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "assistant_debug_logs"
       SET "userPrompt" = NULL,
           "processedOutput" = NULL,
           "invalidParserOutput" = NULL,
           "resolutionNotes" = '[]'::jsonb,
           "modelCalls" = '[]'::jsonb,
           "error" = NULL`
    );
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Scrubbed debug content cannot be restored safely.
  }
}
