import { MigrationInterface, QueryRunner } from 'typeorm';

export class DeadLetterTimerCompletionNotifications1774466000000 implements MigrationInterface {
  name = 'DeadLetterTimerCompletionNotifications1774466000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "notification_outbox" DROP CONSTRAINT "CHK_notification_outbox_lease_state"`
    );
    await queryRunner.query(`
      ALTER TABLE "notification_outbox"
      ADD CONSTRAINT "CHK_notification_outbox_lease_state" CHECK (
        ("status" = 'pending' AND "processedAt" IS NULL AND "claimToken" IS NULL AND "claimedUntil" IS NULL)
        OR ("status" = 'processing' AND "processedAt" IS NULL AND "claimToken" IS NOT NULL AND "claimedUntil" IS NOT NULL)
        OR ("status" = 'processed' AND "processedAt" IS NOT NULL AND "claimToken" IS NULL AND "claimedUntil" IS NULL)
        OR ("status" = 'failed' AND "processedAt" IS NOT NULL AND "claimToken" IS NULL AND "claimedUntil" IS NULL AND "lastError" IS NOT NULL)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_notification_outbox_user_order"
      ON "notification_outbox" ("type", "userId", "createdAt", "id")
      WHERE "processedAt" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_notification_outbox_user_order"`
    );
    await queryRunner.query(
      `UPDATE "notification_outbox" SET "status" = 'processed' WHERE "status" = 'failed'`
    );
    await queryRunner.query(
      `ALTER TABLE "notification_outbox" DROP CONSTRAINT "CHK_notification_outbox_lease_state"`
    );
    await queryRunner.query(`
      ALTER TABLE "notification_outbox"
      ADD CONSTRAINT "CHK_notification_outbox_lease_state" CHECK (
        ("status" = 'pending' AND "processedAt" IS NULL AND "claimToken" IS NULL AND "claimedUntil" IS NULL)
        OR ("status" = 'processing' AND "processedAt" IS NULL AND "claimToken" IS NOT NULL AND "claimedUntil" IS NOT NULL)
        OR ("status" = 'processed' AND "processedAt" IS NOT NULL AND "claimToken" IS NULL AND "claimedUntil" IS NULL)
      )
    `);
  }
}
