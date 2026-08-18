import { MigrationInterface, QueryRunner } from 'typeorm';

export class RepairSubIntentionsSchema1774100000000 implements MigrationInterface {
  name = 'RepairSubIntentionsSchema1774100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "preferences" ADD COLUMN IF NOT EXISTS "intentionSubIntentions" boolean'
    );
    await queryRunner.query(
      'UPDATE "preferences" SET "intentionSubIntentions" = false WHERE "intentionSubIntentions" IS NULL'
    );
    await queryRunner.query(
      'ALTER TABLE "preferences" ALTER COLUMN "intentionSubIntentions" SET DEFAULT false'
    );
    await queryRunner.query(
      'ALTER TABLE "preferences" ALTER COLUMN "intentionSubIntentions" SET NOT NULL'
    );
    await queryRunner.query(
      'ALTER TABLE "intentions" ADD COLUMN IF NOT EXISTS "parentIntentionId" uuid'
    );
    await queryRunner.query(
      'ALTER TABLE "statistics" ADD COLUMN IF NOT EXISTS "subIntentions" jsonb'
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_intentions_parentIntentionId" ON "intentions" ("parentIntentionId")'
    );
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'FK_intentions_parentIntentionId'
        ) THEN
          ALTER TABLE "intentions"
            ADD CONSTRAINT "FK_intentions_parentIntentionId"
            FOREIGN KEY ("parentIntentionId")
            REFERENCES "intentions"("id")
            ON DELETE SET NULL
            ON UPDATE NO ACTION;
        END IF;
      END
      $$;
    `);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // No-op repair migration. The original AddSubIntentions migration owns the
    // schema rollback; this migration only makes partially upgraded databases safe.
  }
}
