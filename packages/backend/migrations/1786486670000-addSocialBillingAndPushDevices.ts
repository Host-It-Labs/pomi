import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSocialBillingAndPushDevices1786486670000 implements MigrationInterface {
  name = 'AddSocialBillingAndPushDevices1786486670000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "email" character varying`
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "UQ_users_email" UNIQUE ("email")`
    );
    await queryRunner.query(`
      CREATE TABLE "social_identities" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "provider" character varying(20) NOT NULL,
        "providerSubject" character varying(255) NOT NULL,
        "email" character varying,
        "userId" uuid NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_social_identity_provider_subject" UNIQUE ("provider", "providerSubject"),
        CONSTRAINT "PK_social_identities" PRIMARY KEY ("id"),
        CONSTRAINT "FK_social_identity_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "push_devices" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "platform" character varying(20) NOT NULL,
        "token" character varying NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "lastSeenAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_push_device_token" UNIQUE ("token"),
        CONSTRAINT "PK_push_devices" PRIMARY KEY ("id"),
        CONSTRAINT "FK_push_device_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_push_device_user_platform" ON "push_devices" ("userId", "platform")`
    );
    await queryRunner.query(`
      INSERT INTO "push_devices" ("userId", "platform", "token")
      SELECT "id", 'android', "fcmToken" FROM "users" WHERE "fcmToken" IS NOT NULL
      ON CONFLICT ("token") DO NOTHING
    `);
    await queryRunner.query(`
      INSERT INTO "push_devices" ("userId", "platform", "token")
      SELECT "id", 'ios', "apnToken" FROM "users" WHERE "apnToken" IS NOT NULL
      ON CONFLICT ("token") DO NOTHING
    `);
    await queryRunner.query(`
      CREATE TABLE "subscriptions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "platform" character varying(20) NOT NULL,
        "productId" character varying(300) NOT NULL,
        "plan" character varying(20) NOT NULL,
        "transactionId" character varying(500) NOT NULL,
        "originalTransactionId" character varying(500) NOT NULL,
        "state" character varying(20) NOT NULL,
        "expiresAt" TIMESTAMP WITH TIME ZONE,
        "autoRenews" boolean,
        "environment" character varying(40),
        "verifiedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_subscription_store_original" UNIQUE ("platform", "originalTransactionId"),
        CONSTRAINT "PK_subscriptions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_subscription_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_subscription_user_expiry" ON "subscriptions" ("userId", "expiresAt")`
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "subscriptions"`);
    await queryRunner.query(`DROP TABLE "push_devices"`);
    await queryRunner.query(`DROP TABLE "social_identities"`);
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "UQ_users_email"`
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "email"`);
  }
}
