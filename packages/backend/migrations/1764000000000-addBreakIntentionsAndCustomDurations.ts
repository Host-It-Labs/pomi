import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBreakIntentionsAndCustomDurations1764000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add new columns to preferences table
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD COLUMN "intentionBreakIntentions" boolean NOT NULL DEFAULT false`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" ADD COLUMN "intentionCustomDurations" boolean NOT NULL DEFAULT false`
    );

    // Add new columns to intentions table
    await queryRunner.query(
      `ALTER TABLE "intentions" ADD COLUMN "type" varchar NOT NULL DEFAULT 'work'`
    );
    await queryRunner.query(
      `ALTER TABLE "intentions" ADD COLUMN "hasCustomDuration" boolean NOT NULL DEFAULT false`
    );
    await queryRunner.query(
      `ALTER TABLE "intentions" ADD COLUMN "customDuration" integer`
    );

    // Drop the old unique constraint and create a new one including the type column
    await queryRunner.query(
      `ALTER TABLE "intentions" DROP CONSTRAINT IF EXISTS "UQ_intentions_userId_slug"`
    );
    await queryRunner.query(
      `ALTER TABLE "intentions" DROP CONSTRAINT IF EXISTS "intentions_userId_slug_key"`
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_intentions_userId_slug_type" ON "intentions" ("userId", "slug", "type")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove the new unique constraint and restore the old one
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_intentions_userId_slug_type"`
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "intentions_userId_slug_key" ON "intentions" ("userId", "slug")`
    );

    // Remove columns from intentions table
    await queryRunner.query(
      `ALTER TABLE "intentions" DROP COLUMN "customDuration"`
    );
    await queryRunner.query(
      `ALTER TABLE "intentions" DROP COLUMN "hasCustomDuration"`
    );
    await queryRunner.query(`ALTER TABLE "intentions" DROP COLUMN "type"`);

    // Remove columns from preferences table
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "intentionCustomDurations"`
    );
    await queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "intentionBreakIntentions"`
    );
  }
}
