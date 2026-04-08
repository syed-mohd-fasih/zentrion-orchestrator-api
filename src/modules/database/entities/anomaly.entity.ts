import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from 'typeorm';

@Entity('anomalies')
@Index(['service'])
@Index(['type'])
@Index(['severity'])
@Index(['timestamp'])
export class Anomaly {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  anomalyId: string;

  @Column({ type: 'timestamptz' })
  @Index()
  timestamp: Date;

  @Column({ type: 'varchar', length: 255 })
  @Index()
  service: string;

  @Column({ type: 'varchar', length: 100 })
  @Index()
  type: string;

  @Column({ type: 'varchar', length: 20 })
  @Index()
  severity: string;

  @Column({ type: 'text' })
  details: string;

  @Column({ type: 'text', array: true, default: '{}' })
  associatedLogs: string[];

  @Column({ type: 'uuid', nullable: true })
  suggestedPolicyDraftId: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>;

  @Column({ type: 'boolean', default: false })
  resolved: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
