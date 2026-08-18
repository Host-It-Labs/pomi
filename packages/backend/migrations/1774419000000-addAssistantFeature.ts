import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAssistantFeature1774419000000 implements MigrationInterface {
  name = 'AddAssistantFeature1774419000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD "assistantExtension" boolean NOT NULL DEFAULT false`
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD "creationSource" character varying NOT NULL DEFAULT 'manual'`
    );
    await queryRunner.query(
      `CREATE TABLE "assistant_settings" ("id" character varying NOT NULL DEFAULT 'default', "textModel" character varying, "transcriptionModel" character varying, "speechModel" character varying, "speechVoice" character varying, "usageBudgetPeriod" character varying NOT NULL DEFAULT 'daily', "usageBudgetCapUsd" numeric(12,6), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_assistant_settings_id" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `INSERT INTO "assistant_settings" ("id") VALUES ('default') ON CONFLICT ("id") DO NOTHING`
    );
    await queryRunner.query(
      `CREATE TABLE "assistant_usage_events" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "localDate" date NOT NULL, "kind" character varying NOT NULL, "costUsd" numeric(12,6) NOT NULL DEFAULT '0', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_assistant_usage_events_id" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_assistant_usage_user_date" ON "assistant_usage_events" ("userId", "localDate")`
    );
    await queryRunner.query(
      `ALTER TABLE "assistant_usage_events" ADD CONSTRAINT "FK_assistant_usage_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "assistant_usage_events" DROP CONSTRAINT "FK_assistant_usage_user"`
    );
    await queryRunner.query(`DROP INDEX "IDX_assistant_usage_user_date"`);
    await queryRunner.query(`DROP TABLE "assistant_usage_events"`);
    await queryRunner.query(`DROP TABLE "assistant_settings"`);
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "creationSource"`);
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "assistantExtension"`
    );
  }
}
