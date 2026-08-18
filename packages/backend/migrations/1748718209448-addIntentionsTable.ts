import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIntentionsTable1748718209448 implements MigrationInterface {
  name = 'AddIntentionsTable1748718209448';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "intentions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "title" character varying NOT NULL, "emoji" character varying NOT NULL, "slug" character varying NOT NULL, "usageCount" integer NOT NULL DEFAULT '0', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_2bad4879de751a08c8afd69d710" UNIQUE ("slug"), CONSTRAINT "PK_1bc1d3b1d635e58e9fbd4cc8554" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `ALTER TABLE "intentions" ADD CONSTRAINT "FK_098f7956d9fedad9d6f5f1f98a4" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "intentions" DROP CONSTRAINT "FK_098f7956d9fedad9d6f5f1f98a4"`
    );
    await queryRunner.query(`DROP TABLE "intentions"`);
  }
}
