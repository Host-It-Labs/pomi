import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1748200000000 implements MigrationInterface {
  name = 'InitialSchema1748200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create users table
    await queryRunner.query(
      `CREATE TABLE "users" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "username" character varying NOT NULL,
        "password" character varying NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_users_username" UNIQUE ("username"),
        CONSTRAINT "PK_users_id" PRIMARY KEY ("id")
      )`
    );

    // Create preferences table (without columns added by later migrations)
    await queryRunner.query(
      `CREATE TABLE "preferences" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "workTimerDuration" integer NOT NULL DEFAULT '1500000',
        "breakTimerDuration" integer NOT NULL DEFAULT '300000',
        "autoStartBreak" boolean NOT NULL DEFAULT true,
        "notifications" boolean NOT NULL DEFAULT true,
        "notifyOnWorkComplete" boolean NOT NULL DEFAULT true,
        "notifyOnBreakComplete" boolean NOT NULL DEFAULT true,
        "notifyBeforeWorkComplete" boolean NOT NULL DEFAULT true,
        "notifyBeforeBreakComplete" boolean NOT NULL DEFAULT true,
        "notifyBeforeTime" integer NOT NULL DEFAULT '300000',
        "soundNotifications" boolean NOT NULL DEFAULT true,
        "pushNotifications" boolean NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_preferences_userId" UNIQUE ("userId"),
        CONSTRAINT "PK_preferences_id" PRIMARY KEY ("id")
      )`
    );

    await queryRunner.query(
      `ALTER TABLE "preferences" ADD CONSTRAINT "FK_preferences_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`
    );

    // Create statistics table (without intention column added by later migration)
    await queryRunner.query(
      `CREATE TABLE "statistics" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "type" character varying NOT NULL,
        "date" character varying NOT NULL,
        "duration" integer NOT NULL,
        "completedAt" bigint NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_statistics_id" PRIMARY KEY ("id")
      )`
    );

    await queryRunner.query(
      `ALTER TABLE "statistics" ADD CONSTRAINT "FK_statistics_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`
    );

    // Note: Intentions table is created by migration 1748718209448-addIntentionsTable.ts
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Note: Intentions table is dropped by migration 1748718209448-addIntentionsTable.ts

    await queryRunner.query(
      `ALTER TABLE "statistics" DROP CONSTRAINT "FK_statistics_userId"`
    );
    await queryRunner.query(`DROP TABLE "statistics"`);

    await queryRunner.query(
      `ALTER TABLE "preferences" DROP CONSTRAINT "FK_preferences_userId"`
    );
    await queryRunner.query(`DROP TABLE "preferences"`);

    await queryRunner.query(`DROP TABLE "users"`);
  }
}
