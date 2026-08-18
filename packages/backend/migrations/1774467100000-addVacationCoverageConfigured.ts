import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddVacationCoverageConfigured1774467100000 implements MigrationInterface {
  name = 'AddVacationCoverageConfigured1774467100000';

  up(queryRunner: QueryRunner) {
    return queryRunner.query(
      `ALTER TABLE "preferences" ADD "vacationCoverageConfigured" boolean NOT NULL DEFAULT false`
    );
  }

  down(queryRunner: QueryRunner) {
    return queryRunner.query(
      `ALTER TABLE "preferences" DROP COLUMN "vacationCoverageConfigured"`
    );
  }
}
