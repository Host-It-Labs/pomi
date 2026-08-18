import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSubIntentions1774000000000 implements MigrationInterface {
  name = 'AddSubIntentions1774000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "preferences" ADD COLUMN "intentionSubIntentions" boolean NOT NULL DEFAULT false'
    );
    await queryRunner.query(
      'ALTER TABLE "intentions" ADD COLUMN "parentIntentionId" uuid'
    );
    await queryRunner.query(
      'ALTER TABLE "statistics" ADD COLUMN "subIntentions" jsonb'
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_intentions_parentIntentionId" ON "intentions" ("parentIntentionId")'
    );
    await queryRunner.query(
      'ALTER TABLE "intentions" ADD CONSTRAINT "FK_intentions_parentIntentionId" FOREIGN KEY ("parentIntentionId") REFERENCES "intentions"("id") ON DELETE SET NULL ON UPDATE NO ACTION'
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "intentions" DROP CONSTRAINT "FK_intentions_parentIntentionId"'
    );
    await queryRunner.query('DROP INDEX "IDX_intentions_parentIntentionId"');
    await queryRunner.query(
      'ALTER TABLE "statistics" DROP COLUMN "subIntentions"'
    );
    await queryRunner.query(
      'ALTER TABLE "intentions" DROP COLUMN "parentIntentionId"'
    );
    await queryRunner.query(
      'ALTER TABLE "preferences" DROP COLUMN "intentionSubIntentions"'
    );
  }
}
