import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTimerContinuationOutbox1774464000000 implements MigrationInterface {
  name = 'AddTimerContinuationOutbox1774464000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "timer_continuation_outbox" (
        "timerId" uuid NOT NULL,
        "payload" jsonb NOT NULL,
        "status" character varying NOT NULL DEFAULT 'pending',
        "attempts" integer NOT NULL DEFAULT 0,
        "availableAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "claimedUntil" TIMESTAMP WITH TIME ZONE,
        "claimToken" uuid,
        "plan" jsonb,
        "planVersion" integer,
        "processedAt" TIMESTAMP WITH TIME ZONE,
        "outcome" character varying,
        "lastError" text,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_timer_continuation_outbox_timerId" PRIMARY KEY ("timerId"),
        CONSTRAINT "CHK_timer_continuation_plan_version" CHECK (("plan" IS NULL AND "planVersion" IS NULL) OR ("plan" IS NOT NULL AND "planVersion" IS NOT NULL)),
        CONSTRAINT "FK_timer_continuation_outbox_timerId" FOREIGN KEY ("timerId") REFERENCES "timer_completion_receipts"("timerId") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_timer_continuation_outbox_pending" ON "timer_continuation_outbox" ("availableAt", "createdAt") WHERE "processedAt" IS NULL`
    );
    await queryRunner.query(`
      INSERT INTO "timer_continuation_outbox"
        ("timerId", "payload", "createdAt", "updatedAt")
      SELECT "timerId", "payload", "createdAt", now()
      FROM "timer_completion_receipts"
      ON CONFLICT ("timerId") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "timer_continuation_outbox"`);
  }
}
