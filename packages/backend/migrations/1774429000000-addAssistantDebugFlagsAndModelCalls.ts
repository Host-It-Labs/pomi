import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAssistantDebugFlagsAndModelCalls1774429000000 implements MigrationInterface {
  name = 'AddAssistantDebugFlagsAndModelCalls1774429000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "assistant_debug_logs" ADD "modelCalls" jsonb NOT NULL DEFAULT '[]'::jsonb`
    );
    await queryRunner.query(
      `ALTER TABLE "assistant_debug_logs" ADD "flagged" boolean NOT NULL DEFAULT false`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "assistant_debug_logs" DROP COLUMN "flagged"`
    );
    await queryRunner.query(
      `ALTER TABLE "assistant_debug_logs" DROP COLUMN "modelCalls"`
    );
  }
}
