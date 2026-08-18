import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TimerCompletionReceipt } from './timer-completion-receipt.entity';

@Entity('timer_continuation_outbox')
@Check(
  'CHK_timer_continuation_plan_version',
  '("plan" IS NULL AND "planVersion" IS NULL) OR ("plan" IS NOT NULL AND "planVersion" IS NOT NULL)'
)
@Check(
  'CHK_timer_continuation_outbox_lease_state',
  `
    ("status" = 'pending' AND "processedAt" IS NULL AND "claimToken" IS NULL AND "claimedUntil" IS NULL)
    OR ("status" = 'processing' AND "processedAt" IS NULL AND "claimToken" IS NOT NULL AND "claimedUntil" IS NOT NULL)
    OR ("status" = 'processed' AND "processedAt" IS NOT NULL AND "claimToken" IS NULL AND "claimedUntil" IS NULL)
  `
)
@Index('IDX_timer_continuation_outbox_pending', ['availableAt', 'createdAt'], {
  where: '"processedAt" IS NULL',
})
export class TimerContinuationOutbox {
  @PrimaryColumn('uuid')
  timerId: string;

  @OneToOne(() => TimerCompletionReceipt, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'timerId' })
  receipt: TimerCompletionReceipt;

  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  @Column({ default: 'pending' })
  status: string;

  @Column({ type: 'integer', default: 0 })
  attempts: number;

  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  availableAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  claimedUntil: Date | null;

  @Column({ type: 'uuid', nullable: true })
  claimToken: string | null;

  @Column({ type: 'jsonb', nullable: true })
  plan: Record<string, unknown> | null;

  @Column({ type: 'integer', nullable: true })
  planVersion: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  processedAt: Date | null;

  @Column({ type: 'varchar', nullable: true })
  outcome: string | null;

  @Column({ type: 'text', nullable: true })
  lastError: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
