import type {
  AssistantDebugLogKind,
  AssistantDebugProcessedOutput,
  AssistantDebugLogSource,
  AssistantDebugLogStatus,
  AssistantDebugModelCall,
  AssistantDebugTimings,
} from '@pomi/shared';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserEntity } from '../users/users.entity';

@Entity('assistant_debug_settings')
export class AssistantDebugSettingEntity {
  @PrimaryColumn({ type: 'uuid' })
  userId: string;

  @OneToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: UserEntity;

  @Column({ default: false })
  enabled: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

@Entity('assistant_debug_logs')
@Index('IDX_assistant_debug_logs_user_created', ['userId', 'createdAt'])
export class AssistantDebugLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar' })
  kind: AssistantDebugLogKind;

  @Column({ type: 'varchar' })
  source: AssistantDebugLogSource;

  @Column({ type: 'varchar' })
  status: AssistantDebugLogStatus;

  @Column({ type: 'text', nullable: true })
  userPrompt: string | null;

  @Column({ type: 'jsonb', nullable: true })
  processedOutput: AssistantDebugProcessedOutput | null;

  @Column({ type: 'text', nullable: true })
  invalidParserOutput: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  resolutionNotes: string[];

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  timings: AssistantDebugTimings;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  modelCalls: AssistantDebugModelCall[];

  @Column({ type: 'boolean', default: false })
  flagged: boolean;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
