import { MigrationInterface, QueryRunner } from 'typeorm';

export class FenceTimerCompletionOutboxLeases1774465000000 implements MigrationInterface {
  name = 'FenceTimerCompletionOutboxLeases1774465000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_notification_outbox_pending"`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_notification_outbox_pending" ON "notification_outbox" ("type", "availableAt", "createdAt") WHERE "processedAt" IS NULL`
    );
    await queryRunner.query(`
      ALTER TABLE "notification_outbox"
      ADD CONSTRAINT "CHK_notification_outbox_lease_state" CHECK (
        ("status" = 'pending' AND "processedAt" IS NULL AND "claimToken" IS NULL AND "claimedUntil" IS NULL)
        OR ("status" = 'processing' AND "processedAt" IS NULL AND "claimToken" IS NOT NULL AND "claimedUntil" IS NOT NULL)
        OR ("status" = 'processed' AND "processedAt" IS NOT NULL AND "claimToken" IS NULL AND "claimedUntil" IS NULL)
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "timer_continuation_outbox"
      ADD CONSTRAINT "CHK_timer_continuation_outbox_lease_state" CHECK (
        ("status" = 'pending' AND "processedAt" IS NULL AND "claimToken" IS NULL AND "claimedUntil" IS NULL)
        OR ("status" = 'processing' AND "processedAt" IS NULL AND "claimToken" IS NOT NULL AND "claimedUntil" IS NOT NULL)
        OR ("status" = 'processed' AND "processedAt" IS NOT NULL AND "claimToken" IS NULL AND "claimedUntil" IS NULL)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "timer_continuation_outbox" DROP CONSTRAINT "CHK_timer_continuation_outbox_lease_state"`
    );
    await queryRunner.query(
      `ALTER TABLE "notification_outbox" DROP CONSTRAINT "CHK_notification_outbox_lease_state"`
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_notification_outbox_pending"`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_notification_outbox_pending" ON "notification_outbox" ("availableAt", "createdAt") WHERE "processedAt" IS NULL`
    );
  }
}
