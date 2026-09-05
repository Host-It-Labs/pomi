import { HabitCadence, IntentionType, TIMER_TYPES } from '@pomi/shared';
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { UserEntity } from '../users/users.entity';

@Entity('intentions')
@Unique(['userId', 'slug', 'type'])
export class Intention {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @ManyToOne(() => UserEntity)
  @JoinColumn({ name: 'userId' })
  user: UserEntity;

  @Column()
  title: string;

  @Column()
  emoji: string;

  @Column()
  slug: string;

  @Column({ type: 'varchar', default: TIMER_TYPES.WORK })
  type: IntentionType;

  @Column({ type: 'uuid', nullable: true })
  parentIntentionId: string | null;

  @ManyToOne(() => Intention, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'parentIntentionId' })
  parentIntention: Intention | null;

  @Column({ default: false })
  hasCustomDuration: boolean;

  @Column({ type: 'int', nullable: true })
  customDuration: number | null;

  @Column({ default: false })
  keepScreenAwake: boolean;

  @Column({ default: false })
  isHabit: boolean;

  @Column({ type: 'varchar', default: 'off' })
  habitCadence: HabitCadence;

  @Column({ default: false })
  isArchived: boolean;

  @Column({ default: false })
  isFavorite: boolean;

  @Column({ default: true })
  allowsTasks: boolean;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ default: false })
  vacationDefault: boolean;

  @Column({ default: 0 })
  usageCount: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
