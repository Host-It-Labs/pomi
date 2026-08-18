import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAssistantDebugLogs1774420000000 implements MigrationInterface {
  name = 'AddAssistantDebugLogs1774420000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "assistant_debug_settings" ("userId" uuid NOT NULL, "enabled" boolean NOT NULL DEFAULT false, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_assistant_debug_settings_user" PRIMARY KEY ("userId"))`
    );
    await queryRunner.query(
      `CREATE TABLE "assistant_debug_logs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "kind" character varying NOT NULL, "userPrompt" text, "audioBase64" text, "audioMimeType" character varying, "transcriptionOutput" text, "parserOutput" text, "error" text, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_assistant_debug_logs_id" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_assistant_debug_logs_user_created" ON "assistant_debug_logs" ("userId", "createdAt")`
    );
    await queryRunner.query(
      `ALTER TABLE "assistant_debug_settings" ADD CONSTRAINT "FK_assistant_debug_settings_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "assistant_debug_logs" ADD CONSTRAINT "FK_assistant_debug_logs_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "assistant_debug_logs" DROP CONSTRAINT "FK_assistant_debug_logs_user"`
    );
    await queryRunner.query(
      `ALTER TABLE "assistant_debug_settings" DROP CONSTRAINT "FK_assistant_debug_settings_user"`
    );
    await queryRunner.query(
      `DROP INDEX "IDX_assistant_debug_logs_user_created"`
    );
    await queryRunner.query(`DROP TABLE "assistant_debug_logs"`);
    await queryRunner.query(`DROP TABLE "assistant_debug_settings"`);
  }
}
