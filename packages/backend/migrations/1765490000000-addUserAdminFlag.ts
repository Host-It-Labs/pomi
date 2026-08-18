import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserAdminFlag1765490000000 implements MigrationInterface {
  name = 'AddUserAdminFlag1765490000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "users" ADD "isAdmin" boolean NOT NULL DEFAULT false'
    );
    await queryRunner.query(
      'UPDATE "users" SET "isAdmin" = true WHERE id = (SELECT id FROM "users" ORDER BY "createdAt" ASC LIMIT 1)'
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "users" DROP COLUMN "isAdmin"');
  }
}
