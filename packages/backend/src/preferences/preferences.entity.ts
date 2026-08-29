import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserEntity } from '../users/users.entity';
import {
  AppLanguage,
  DEFAULT_APP_LANGUAGE,
  TaskDefaultDueDateMode,
  TaskPriority,
  TaskSortMode,
} from '@pomi/shared';

@Entity('preferences')
export class Preferences {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  userId: string;

  @OneToOne(() => UserEntity)
  @JoinColumn({ name: 'userId' })
  user: UserEntity;

  @Column({
    type: 'varchar',
    length: 16,
    nullable: true,
    default: DEFAULT_APP_LANGUAGE,
  })
  language: AppLanguage;

  @Column({ default: 25 * 60 * 1000 })
  workTimerDuration: number;

  @Column({ default: 5 * 60 * 1000 })
  breakTimerDuration: number;

  @Column({ default: false })
  autoStartBreak: boolean;

  @Column({ default: true })
  notifications: boolean;

  @Column({ default: true })
  notifyOnWorkComplete: boolean;

  @Column({ default: true })
  notifyOnBreakComplete: boolean;

  @Column({ default: true })
  notifyBeforeWorkComplete: boolean;

  @Column({ default: 5 * 60 * 1000 })
  notifyBeforeTime: number;

  @Column({ default: true })
  soundNotifications: boolean;

  @Column({ default: true })
  pushNotifications: boolean;

  @Column({ default: 'UTC' })
  timeZone: string;

  @Column({ default: false })
  globalShortcut: boolean;

  @Column({ default: true })
  keyboardShortcuts: boolean;

  @Column({ default: false })
  intentionExtension: boolean;

  @Column({ default: false })
  intentionRequireSelection: boolean;

  @Column({ default: false })
  intentionShowDailyCount: boolean;

  @Column({ default: false })
  intentionBreakIntentions: boolean;

  @Column({ default: false })
  intentionMultiSelect: boolean;

  @Column({ default: false })
  intentionShowBreakIntentionsInLongBreak: boolean;

  @Column({ default: false })
  intentionCustomDurations: boolean;

  @Column({ default: false })
  intentionSubIntentions: boolean;

  @Column({ default: false })
  intentionHabits: boolean;

  @Column({ default: true })
  workTimerLogsExtension: boolean;

  @Column({ default: false })
  sessionsExtension: boolean;

  @Column({ default: 3 })
  sessionPomodorosCount: number;

  @Column({ default: true })
  sessionHasLongBreak: boolean;

  @Column({ default: 15 * 60 * 1000 })
  sessionLongBreakDuration: number;

  @Column({ default: false })
  resetBreakOnFirstIntention: boolean;

  @Column({ default: false })
  resetLongBreakOnFirstIntention: boolean;

  @Column({ default: false })
  sessionShowLongBreakButton: boolean;

  @Column({ default: false })
  sessionShowEta: boolean;

  @Column({ default: false })
  sessionStackTimers: boolean;

  @Column({ default: false })
  sessionAutoDetectLongBreak: boolean;

  @Column({ default: false })
  keepScreenAwake: boolean;

  @Column({ default: false })
  undoAlerts: boolean;

  @Column({ default: false })
  tasksExtension: boolean;

  @Column({ default: true })
  tasksShowSetupPrompts: boolean;

  @Column({ default: false })
  tasksShowInMinimizedTimer: boolean;

  @Column({ default: true })
  tasksAutoSwitchToIntentionMode: boolean;

  @Column({ default: false })
  tasksDuringBreaks: boolean;

  @Column({ type: 'varchar', default: 'tomorrow' })
  taskDefaultDueDateMode: TaskDefaultDueDateMode;

  @Column({ default: 1 })
  taskDefaultDueDateDays: number;

  @Column({ type: 'varchar', default: 'default' })
  taskDefaultSortMode: TaskSortMode;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  hiddenHelpTips: string[];

  @Column({
    type: 'jsonb',
    default: () => `'["high", "urgent"]'::jsonb`,
  })
  taskReminderPriorities: TaskPriority[];

  @Column({ default: 0 })
  taskBeforeDueReminderMinutes: number;

  @Column({ default: 30 })
  taskUrgentReminderRepeatIntervalMinutes: number;

  @Column({ default: true })
  taskUrgentReminderRepeatEnabled: boolean;

  @Column({ default: false })
  advancedSkip: boolean;

  @Column({ default: false })
  timerExtension: boolean;

  @Column({ default: false })
  timerExtrasSeen: boolean;

  @Column({ default: false })
  sessionsExtrasSeen: boolean;

  @Column({ default: false })
  intentionsExtrasSeen: boolean;

  @Column({ default: false })
  assistantExtension: boolean;

  @Column({ default: false })
  assistantTaskTranscriptsEnabled: boolean;

  @Column({ type: 'integer', default: 15 })
  assistantTaskTranscriptMinWords: number;

  @Column({ default: false })
  destinationDescriptionsEnabled: boolean;

  @Column({ default: false })
  listsExtension: boolean;

  @Column({ default: false })
  vacationExtension: boolean;

  @Column({ default: false })
  vacationCoverageConfigured: boolean;

  @Column({ default: false })
  tasksShowVacationCovered: boolean;

  @Column({ default: false })
  longBreakToBreakEnabled: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
