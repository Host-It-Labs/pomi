import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { UserEntity } from '../users/users.entity';

@Entity('notification_outbox')
@Unique('UQ_notification_outbox_idempotencyKey', ['idempotencyKey'])
@Check(
  'CHK_notification_outbox_lease_state',
  `
    ("status" = 'pending' AND "processedAt" IS NULL AND "claimToken" IS NULL AND "claimedUntil" IS NULL)
    OR ("status" = 'processing' AND "processedAt" IS NULL AND "claimToken" IS NOT NULL AND "claimedUntil" IS NOT NULL)
    OR ("status" = 'processed' AND "processedAt" IS NOT NULL AND "claimToken" IS NULL AND "claimedUntil" IS NULL)
    OR ("status" = 'failed' AND "processedAt" IS NOT NULL AND "claimToken" IS NULL AND "claimedUntil" IS NULL AND "lastError" IS NOT NULL)
  `
)
@Index(
  'IDX_notification_outbox_pending',
  ['type', 'availableAt', 'createdAt'],
  { where: '"processedAt" IS NULL' }
)
@Index(
  'IDX_notification_outbox_user_order',
  ['type', 'userId', 'createdAt', 'id'],
  { where: '"processedAt" IS NULL' }
)
export class NotificationOutbox {
  @PrimaryColumn('uuid')
  id: string;

  @Column()
  idempotencyKey: string;

  @Column('uuid')
  userId: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: UserEntity;

  @Column()
  type: string;

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

  @Column({ type: 'timestamptz', nullable: true })
  processedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  lastError: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
