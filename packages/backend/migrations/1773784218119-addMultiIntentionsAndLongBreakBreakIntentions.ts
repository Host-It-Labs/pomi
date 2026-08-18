import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMultiIntentionsAndLongBreakBreakIntentions1773784218119 implements MigrationInterface {
  name = 'AddMultiIntentionsAndLongBreakBreakIntentions1773784218119';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "preferences" ADD COLUMN "intentionMultiSelect" boolean NOT NULL DEFAULT false'
    );
    await queryRunner.query(
      'ALTER TABLE "preferences" ADD COLUMN "intentionShowBreakIntentionsInLongBreak" boolean NOT NULL DEFAULT false'
    );
    await queryRunner.query(
      'ALTER TABLE "statistics" ADD COLUMN "intentions" text[]'
    );
    await queryRunner.query(
      'UPDATE "statistics" SET "intentions" = ARRAY["intention"]::text[] WHERE "intention" IS NOT NULL AND "intention" <> \'\''
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "statistics" DROP COLUMN "intentions"'
    );
    await queryRunner.query(
      'ALTER TABLE "preferences" DROP COLUMN "intentionShowBreakIntentionsInLongBreak"'
    );
    await queryRunner.query(
      'ALTER TABLE "preferences" DROP COLUMN "intentionMultiSelect"'
    );
  }
}
