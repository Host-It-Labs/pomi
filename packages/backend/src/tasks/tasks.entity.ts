import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  TaskCreationSource,
  TaskPriority,
  TaskLifecycleEventType,
  TaskFollowUpDefinition,
  TaskRecurrenceAnchorMode,
  TaskStatus,
  TimerTypes,
  TIMER_TYPES,
} from '@pomi/shared';
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserEntity } from '../users/users.entity';

@Entity('tasks')
export class TaskEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: UserEntity;

  @Column()
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'text', nullable: true })
  sourceTranscript: string | null;

  @Column({ type: 'varchar', default: 'manual' })
  creationSource: TaskCreationSource;

  @Column({ type: 'varchar', nullable: true })
  importSource: string | null;

  @Column({ type: 'varchar', nullable: true })
  importSourceTaskId: string | null;

  @Column({ type: 'date', nullable: true })
  dueDate: string | null;

  @Column({ type: 'varchar', nullable: true })
  dueTime: string | null;

  @Column({ type: 'integer', nullable: true })
  manualOrder: number | null;

  @Column({ default: false })
  manualOrderOverride: boolean;

  @Column({ type: 'varchar', nullable: true })
  lastReminderKey: string | null;

  @Column({ type: 'varchar', default: TASK_PRIORITIES.NORMAL })
  priority: TaskPriority;

  @Column({ type: 'varchar', default: TASK_STATUSES.ACTIVE })
  status: TaskStatus;

  @Column({ type: 'varchar', default: TIMER_TYPES.WORK })
  timerType: TimerTypes;

  @Column({ type: 'integer', nullable: true })
  customDuration: number | null;

  @Column({ type: 'timestamp', nullable: true })
  pinnedAt: Date | null;

  @Column({ type: 'varchar', nullable: true })
  intentionSlug: string | null;

  @Column({ type: 'varchar', nullable: true })
  subIntentionSlug: string | null;

  @Column({ type: 'varchar', nullable: true })
  recurrenceRule: string | null;

  @Column({ type: 'double precision', nullable: true })
  recurrenceInterval: number | null;

  @Column({ type: 'integer', default: 0 })
  recurrenceSequenceIndex: number;

  @Column({ type: 'varchar', default: 'planned' })
  recurrenceAnchorMode: TaskRecurrenceAnchorMode;

  @Column({ type: 'uuid', nullable: true })
  followUpTaskId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  followUpDefinition: TaskFollowUpDefinition | null;

  @Column({ type: 'integer', nullable: true })
  followUpDelayDays: number | null;

  @Column({ type: 'uuid', nullable: true })
  followUpSourceTaskId: string | null;

  @Column({ type: 'varchar', default: 'task' })
  itemKind: 'task' | 'listItem' | 'followUp' | 'followUpTemplate';

  followUpParent?: { id: string; title: string } | null;

  @Column({ type: 'uuid', nullable: true })
  listId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  taskRestoreState: Record<string, unknown> | null;

  @Column({ default: false })
  vacationEligible: boolean;

  @Column({ type: 'uuid', nullable: true })
  lastVacationRunId: string | null;

  @Column({ type: 'date', nullable: true })
  lastVacationShiftedOn: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

@Entity('task_import_runs')
export class TaskImportRunEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: UserEntity;

  @Column({ type: 'varchar' })
  source: string;

  @Column({ type: 'integer' })
  importedCount: number;

  @Column({ type: 'integer' })
  skippedCount: number;

  @CreateDateColumn()
  createdAt: Date;
}

@Entity('task_events')
export class TaskEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'uuid' })
  taskId: string;

  @ManyToOne(() => TaskEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'taskId' })
  task: TaskEntity;

  @Column({ type: 'varchar' })
  eventType: TaskLifecycleEventType;

  @Column()
  titleSnapshot: string;

  @Column({ type: 'varchar', default: TASK_PRIORITIES.NORMAL })
  prioritySnapshot: TaskPriority;

  @Column({ type: 'varchar', default: TIMER_TYPES.WORK })
  timerTypeSnapshot: TimerTypes;

  @Column({ type: 'varchar', nullable: true })
  intentionSlugSnapshot: string | null;

  @Column({ type: 'varchar', nullable: true })
  subIntentionSlugSnapshot: string | null;

  @Column({ type: 'date', nullable: true })
  dueDate: string | null;

  @Column({ type: 'varchar', nullable: true })
  dueTime: string | null;

  @Column({ type: 'integer', default: 0 })
  recurrenceSequenceIndex: number;

  @Column({ type: 'varchar', nullable: true })
  recurrenceRuleSnapshot: string | null;

  @Column({ type: 'double precision', nullable: true })
  recurrenceIntervalSnapshot: number | null;

  @Column({ type: 'varchar', default: 'planned' })
  recurrenceAnchorModeSnapshot: TaskRecurrenceAnchorMode;

  @Column({ default: false })
  isOverdue: boolean;

  @Column({ type: 'timestamp' })
  occurredAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
