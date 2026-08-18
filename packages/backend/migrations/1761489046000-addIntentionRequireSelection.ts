import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddIntentionRequireSelection1761489046000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'preferences',
      new TableColumn({
        name: 'intentionRequireSelection',
        type: 'boolean',
        default: false,
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('preferences', 'intentionRequireSelection');
  }
}
