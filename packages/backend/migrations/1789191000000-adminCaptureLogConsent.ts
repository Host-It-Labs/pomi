import { MigrationInterface, QueryRunner } from 'typeorm';

export class AdminCaptureLogConsent1789191000000 implements MigrationInterface {
  name = 'AdminCaptureLogConsent1789191000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "assistant_debug_settings" ADD "consentVersion" integer`
    );
    await queryRunner.query(
      `ALTER TABLE "assistant_debug_settings" ADD "generation" integer NOT NULL DEFAULT 0`
    );
    await queryRunner.query(
      `ALTER TABLE "assistant_debug_logs" ADD "contentTruncated" boolean NOT NULL DEFAULT false`
    );
    await queryRunner.query(
      `UPDATE "assistant_debug_settings" SET "enabled" = false, "consentVersion" = NULL, "generation" = 1`
    );
    await queryRunner.query(`
      DELETE FROM "assistant_debug_logs"
      WHERE "id" IN (
        SELECT "id"
        FROM (
          SELECT
            "id",
            ROW_NUMBER() OVER (
              PARTITION BY "userId"
              ORDER BY "createdAt" DESC, "id" DESC
            ) AS "flagRank"
          FROM "assistant_debug_logs"
          WHERE "flagged" = true
        ) AS "rankedFlaggedLogs"
        WHERE "flagRank" > 200
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "assistant_debug_logs" DROP COLUMN "contentTruncated"`
    );
    await queryRunner.query(
      `ALTER TABLE "assistant_debug_settings" DROP COLUMN "generation"`
    );
    await queryRunner.query(
      `ALTER TABLE "assistant_debug_settings" DROP COLUMN "consentVersion"`
    );
  }
}
