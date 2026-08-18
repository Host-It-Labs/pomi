import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserEntity } from '../users/users.entity';

@Entity('development_fixture_markers')
@Index('UQ_development_fixture_markers_name', ['fixtureName'], {
  unique: true,
})
export class DevelopmentFixtureMarkerEntity {
  @PrimaryColumn({ type: 'uuid' })
  userId: string;

  @OneToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: UserEntity;

  @Column({ type: 'varchar' })
  fixtureName: string;

  @Column({ type: 'integer' })
  seedVersion: number;

  @Column({ type: 'varchar' })
  credentialFingerprint: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
