import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveOngoingNotification1761986176329 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('preferences', 'ongoingNotification');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "preferences" 
            ADD "ongoingNotification" boolean NOT NULL DEFAULT false
        `);
  }
}
