import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTimerCompletionOutbox1774463000000 implements MigrationInterface {
  name = 'AddTimerCompletionOutbox1774463000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "timer_completion_receipts" (
        "timerId" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "effectVersion" integer NOT NULL,
        "completedAt" bigint NOT NULL,
        "payload" jsonb NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_timer_completion_receipts_timerId" PRIMARY KEY ("timerId"),
        CONSTRAINT "FK_timer_completion_receipts_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "notification_outbox" (
        "id" uuid NOT NULL,
        "idempotencyKey" character varying NOT NULL,
        "userId" uuid NOT NULL,
        "type" character varying NOT NULL,
        "payload" jsonb NOT NULL,
        "status" character varying NOT NULL DEFAULT 'pending',
        "attempts" integer NOT NULL DEFAULT 0,
        "availableAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "claimedUntil" TIMESTAMP WITH TIME ZONE,
        "claimToken" uuid,
        "processedAt" TIMESTAMP WITH TIME ZONE,
        "lastError" text,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_notification_outbox_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_notification_outbox_idempotencyKey" UNIQUE ("idempotencyKey"),
        CONSTRAINT "FK_notification_outbox_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_notification_outbox_pending" ON "notification_outbox" ("availableAt", "createdAt") WHERE "processedAt" IS NULL`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "notification_outbox"`);
    await queryRunner.query(`DROP TABLE "timer_completion_receipts"`);
  }
}
