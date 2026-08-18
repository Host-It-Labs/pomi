import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('assistant_settings')
export class AssistantSettingsEntity {
  @PrimaryColumn({ type: 'varchar', default: 'default' })
  id: string;

  @Column({ type: 'varchar', nullable: true })
  textModel: string | null;

  @Column({ type: 'varchar', nullable: true })
  transcriptionModel: string | null;

  @Column({ type: 'varchar', nullable: true })
  speechModel: string | null;

  @Column({ type: 'varchar', nullable: true })
  speechVoice: string | null;

  @Column({ type: 'integer', nullable: true, default: 10 })
  assistantRecordingMaxMinutes: number | null;

  @Column({ type: 'varchar', default: 'daily' })
  usageBudgetPeriod: 'daily' | 'monthly';

  @Column({ type: 'numeric', precision: 12, scale: 6, nullable: true })
  usageBudgetCapUsd: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
