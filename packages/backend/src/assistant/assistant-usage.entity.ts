import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { UserEntity } from '../users/users.entity';

@Entity('assistant_usage_events')
export class AssistantUsageEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: UserEntity;

  @Column({ type: 'date' })
  localDate: string;

  @Column({ type: 'varchar' })
  kind: 'transcription' | 'chat';

  @Column({ type: 'numeric', precision: 12, scale: 6, default: 0 })
  costUsd: string;

  @CreateDateColumn()
  createdAt: Date;
}
