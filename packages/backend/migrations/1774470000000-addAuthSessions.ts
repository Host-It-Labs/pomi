import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAuthSessions1774470000000 implements MigrationInterface {
  name = 'AddAuthSessions1774470000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "auth_sessions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "familyId" uuid NOT NULL,
        "refreshTokenHash" character varying NOT NULL,
        "currentRefreshTokenCiphertext" text NOT NULL,
        "previousRefreshTokenHash" character varying,
        "previousRefreshTokenExpiresAt" TIMESTAMP WITH TIME ZONE,
        "platform" character varying NOT NULL,
        "deviceId" character varying,
        "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "lastUsedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "revokedAt" TIMESTAMP WITH TIME ZONE,
        "revocationReason" character varying,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_auth_sessions_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_auth_sessions_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_auth_sessions_userId" ON "auth_sessions" ("userId")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_auth_sessions_familyId" ON "auth_sessions" ("familyId")`
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_auth_sessions_refreshTokenHash" ON "auth_sessions" ("refreshTokenHash")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."UQ_auth_sessions_refreshTokenHash"`
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_auth_sessions_familyId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_auth_sessions_userId"`);
    await queryRunner.query(`DROP TABLE "auth_sessions"`);
  }
}
