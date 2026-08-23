import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

@Entity('push_devices')
@Unique('UQ_push_device_token', ['token'])
@Index('IDX_push_device_user_platform', ['userId', 'platform'])
export class PushDeviceEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 20 })
  platform: 'android' | 'ios';

  @Column({ type: 'varchar' })
  token: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  lastSeenAt: Date;
}
