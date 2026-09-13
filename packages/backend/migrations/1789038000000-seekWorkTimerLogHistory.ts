import { MigrationInterface, QueryRunner } from 'typeorm';

export class SeekWorkTimerLogHistory1789038000000 implements MigrationInterface {
  name = 'SeekWorkTimerLogHistory1789038000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_statistics_user_completed_at_id" ON "statistics" ("userId", "completedAt" DESC, "id" DESC)`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_statistics_user_completed_at_id"`);
  }
}
