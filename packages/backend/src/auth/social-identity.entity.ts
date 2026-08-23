import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { UserEntity } from '../users/users.entity';

@Entity('social_identities')
@Unique('UQ_social_identity_provider_subject', ['provider', 'providerSubject'])
export class SocialIdentityEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 20 })
  provider: 'google' | 'apple';

  @Column({ type: 'varchar', length: 255 })
  providerSubject: string;

  @Column({ type: 'varchar', nullable: true })
  email?: string | null;

  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: UserEntity;

  @CreateDateColumn()
  createdAt: Date;
}
