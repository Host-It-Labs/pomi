import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDevelopmentFixtureMarkers1774460000000 implements MigrationInterface {
  name = 'AddDevelopmentFixtureMarkers1774460000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "development_fixture_markers" ("userId" uuid NOT NULL, "fixtureName" character varying NOT NULL, "seedVersion" integer NOT NULL, "credentialFingerprint" character varying NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_development_fixture_markers_user" PRIMARY KEY ("userId"))`
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_development_fixture_markers_name" ON "development_fixture_markers" ("fixtureName")`
    );
    await queryRunner.query(
      `ALTER TABLE "development_fixture_markers" ADD CONSTRAINT "FK_development_fixture_markers_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "development_fixture_markers" DROP CONSTRAINT "FK_development_fixture_markers_user"`
    );
    await queryRunner.query(
      `DROP INDEX "public"."UQ_development_fixture_markers_name"`
    );
    await queryRunner.query(`DROP TABLE "development_fixture_markers"`);
  }
}
