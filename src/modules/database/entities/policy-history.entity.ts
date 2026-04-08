import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from 'typeorm';

@Entity('policy_history')
@Index(['policyId'])
@Index(['timestamp'])
export class PolicyHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  @Index()
  policyId: string;

  @Column({ type: 'varchar', length: 50 })
  action: string;

  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  @Index()
  timestamp: Date;

  @Column({ type: 'varchar', length: 255 })
  userId: string;

  @Column({ type: 'text' })
  details: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>;
}
