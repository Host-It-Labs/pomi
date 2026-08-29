import { MigrationInterface, QueryRunner } from 'typeorm';

export class PersistVacationProcessingState1774469000000 implements MigrationInterface {
  name = 'PersistVacationProcessingState1774469000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "vacation_states" ADD "lastProcessedOn" date`
    );
    await queryRunner.query(
      `ALTER TABLE "vacation_states" ADD "lastProcessedTimeZone" character varying`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "vacation_states" DROP COLUMN "lastProcessedTimeZone"`
    );
    await queryRunner.query(
      `ALTER TABLE "vacation_states" DROP COLUMN "lastProcessedOn"`
    );
  }
}
