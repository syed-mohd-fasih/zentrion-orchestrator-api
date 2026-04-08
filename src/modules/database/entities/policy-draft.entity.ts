import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from 'typeorm';

@Entity('policy_drafts')
@Index(['status'])
@Index(['service'])
@Index(['createdAt'])
export class PolicyDraft {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  draftId: string;

  @CreateDateColumn({ type: 'timestamptz' })
  @Index()
  createdAt: Date;

  @Column({ type: 'varchar', length: 255 })
  createdBy: string;

  @Column({ type: 'varchar', length: 255 })
  @Index()
  service: string;

  @Column({ type: 'varchar', length: 255, default: 'default' })
  namespace: string;

  @Column({ type: 'text' })
  yamlContent: string;

  @Column({ type: 'varchar', length: 50, default: 'pending' })
  @Index()
  status: string;

  @Column({ type: 'text' })
  reason: string;

  @Column({ type: 'timestamptz', nullable: true })
  appliedAt: Date;

  @Column({ type: 'varchar', length: 255, nullable: true })
  approvedBy: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  rejectedBy: string;

  @Column({ type: 'text', nullable: true })
  rejectionReason: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  anomalyId: string;
}
