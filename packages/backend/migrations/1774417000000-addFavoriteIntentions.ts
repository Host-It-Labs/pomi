import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFavoriteIntentions1774417000000 implements MigrationInterface {
  name = 'AddFavoriteIntentions1774417000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "intentions" ADD "isFavorite" boolean NOT NULL DEFAULT false`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "intentions" DROP COLUMN "isFavorite"`
    );
  }
}
