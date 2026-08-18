import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFavoriteLists1774467200000 implements MigrationInterface {
  name = 'AddFavoriteLists1774467200000';

  up(queryRunner: QueryRunner) {
    return queryRunner.query(
      `ALTER TABLE "lists" ADD "isFavorite" boolean NOT NULL DEFAULT false`
    );
  }

  down(queryRunner: QueryRunner) {
    return queryRunner.query(`ALTER TABLE "lists" DROP COLUMN "isFavorite"`);
  }
}
