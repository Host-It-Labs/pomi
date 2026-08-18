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

@Entity('statistics')
export class Statistic {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @ManyToOne(() => UserEntity)
  @JoinColumn({ name: 'userId' })
  user: UserEntity;

  @Column()
  type: string;

  @Column()
  date: string;

  @Column()
  duration: number;

  @Column({ type: 'bigint' })
  completedAt: number;

  @Column({ type: 'text', nullable: true })
  intention: string | null;

  @Column('text', { array: true, nullable: true })
  intentions: string[] | null;

  @Column({ type: 'jsonb', nullable: true })
  subIntentions: Record<string, string> | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
