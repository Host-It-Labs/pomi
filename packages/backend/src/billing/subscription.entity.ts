import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  Unique,
} from 'typeorm';
import { UserEntity } from '../users/users.entity';

@Entity('subscriptions')
@Unique('UQ_subscription_store_original', ['platform', 'originalTransactionId'])
@Index('IDX_subscription_user_expiry', ['userId', 'expiresAt'])
export class SubscriptionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: UserEntity;

  @Column({ type: 'varchar', length: 20 })
  platform: 'ios' | 'android';

  @Column({ type: 'varchar', length: 300 })
  productId: string;

  @Column({ type: 'varchar', length: 20 })
  plan: 'monthly' | 'yearly';

  @Column({ type: 'varchar', length: 500 })
  transactionId: string;

  @Column({ type: 'varchar', length: 500 })
  originalTransactionId: string;

  @Column({ type: 'varchar', length: 20 })
  state: 'active' | 'expired' | 'pending' | 'revoked';

  @Column({ type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @Column({ type: 'boolean', nullable: true })
  autoRenews: boolean | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  environment: string | null;

  @Column({ type: 'timestamptz' })
  verifiedAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
