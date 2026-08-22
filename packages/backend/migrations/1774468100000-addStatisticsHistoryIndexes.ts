import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStatisticsHistoryIndexes1774468100000 implements MigrationInterface {
  name = 'AddStatisticsHistoryIndexes1774468100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_statistics_user_type_completed_at" ON "statistics" ("userId", "type", "completedAt")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_statistics_user_type_date" ON "statistics" ("userId", "type", "date")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_statistics_user_type_date"`);
    await queryRunner.query(
      `DROP INDEX "IDX_statistics_user_type_completed_at"`
    );
  }
}
