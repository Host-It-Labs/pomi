import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddOngoingNotification1761848855000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'preferences',
      new TableColumn({
        name: 'ongoingNotification',
        type: 'boolean',
        default: false,
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('preferences', 'ongoingNotification');
  }
}
