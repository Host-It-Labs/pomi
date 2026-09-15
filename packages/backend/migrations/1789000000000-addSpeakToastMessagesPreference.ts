import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSpeakToastMessagesPreference1789000000000 implements MigrationInterface {
  name = 'AddSpeakToastMessagesPreference1789000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "preferences" ADD "speakToastMessages" boolean NOT NULL DEFAULT true'
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "preferences" DROP COLUMN "speakToastMessages"'
    );
  }
}
