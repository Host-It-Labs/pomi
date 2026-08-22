import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDurableBillingCheckouts1786579200000 implements MigrationInterface {
  name = 'AddDurableBillingCheckouts1786579200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "billing_checkouts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tokenHash" character(64) NOT NULL,
        "userId" uuid,
        "claimedAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_billing_checkout_token_hash" UNIQUE ("tokenHash"),
        CONSTRAINT "PK_billing_checkouts" PRIMARY KEY ("id"),
        CONSTRAINT "FK_billing_checkout_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "billing_checkouts"`);
  }
}
