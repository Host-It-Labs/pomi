import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLongBreakIntentionType1773784218118 implements MigrationInterface {
  name = 'AddLongBreakIntentionType1773784218118';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop the old unique constraint on (userId, slug) and the index
    // to allow same slug across different intention types (work, break, longBreak)
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."UQ_intentions_userId_slug_type"`
    );
    await queryRunner.query(
      `ALTER TABLE "intentions" DROP CONSTRAINT IF EXISTS "UQ_a8c25b93550c91df6d9473a0a46"`
    );
    await queryRunner.query(
      `ALTER TABLE "intentions" ADD CONSTRAINT "UQ_intentions_userId_slug_type" UNIQUE ("userId", "slug", "type")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "intentions" DROP CONSTRAINT IF EXISTS "UQ_intentions_userId_slug_type"`
    );
    await queryRunner.query(
      `ALTER TABLE "intentions" ADD CONSTRAINT "UQ_a8c25b93550c91df6d9473a0a46" UNIQUE ("userId", "slug")`
    );
  }
}
