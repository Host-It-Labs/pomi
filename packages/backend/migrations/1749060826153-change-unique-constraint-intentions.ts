import { MigrationInterface, QueryRunner } from 'typeorm';

export class ChangeUniqueConstraintIntentions1749060826153 implements MigrationInterface {
  name = 'ChangeUniqueConstraintIntentions1749060826153';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "intentions" DROP CONSTRAINT "UQ_2bad4879de751a08c8afd69d710"`
    );
    await queryRunner.query(
      `ALTER TABLE "intentions" ADD CONSTRAINT "UQ_a8c25b93550c91df6d9473a0a46" UNIQUE ("userId", "slug")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "intentions" DROP CONSTRAINT "UQ_a8c25b93550c91df6d9473a0a46"`
    );
    await queryRunner.query(
      `ALTER TABLE "intentions" ADD CONSTRAINT "UQ_2bad4879de751a08c8afd69d710" UNIQUE ("slug")`
    );
  }
}
