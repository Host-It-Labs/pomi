import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('auth_sessions')
@Index('IDX_auth_sessions_userId', ['userId'])
@Index('IDX_auth_sessions_familyId', ['familyId'])
export class AuthSessionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  userId: string;

  @Column('uuid')
  familyId: string;

  @Column()
  refreshTokenHash: string;

  @Column({ type: 'text' })
  currentRefreshTokenCiphertext: string;

  @Column({ type: 'varchar', nullable: true })
  previousRefreshTokenHash: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  previousRefreshTokenExpiresAt: Date | null;

  @Column()
  platform: string;

  @Column({ type: 'varchar', nullable: true })
  deviceId: string | null;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz' })
  lastUsedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @Column({ type: 'varchar', nullable: true })
  revocationReason: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
