import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from 'typeorm';

/**
 * `policy_drafts` table — Istio AuthorizationPolicy manifests awaiting review.
 *
 * A draft is created automatically when an anomaly meets the severity
 * threshold, or manually by an admin. It carries the full YAML manifest
 * (`yamlContent`) plus workflow fields (`status`, `approvedBy`, `rejectedBy`,
 * `appliedAt`). Once approved and applied, the manifest is pushed to the
 * cluster and the row's `status` flips to `applied`.
 */
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
  createdAt: Date;

  @Column({ type: 'varchar', length: 255 })
  createdBy: string;

  @Column({ type: 'varchar', length: 255 })
  service: string;

  @Column({ type: 'varchar', length: 255, default: 'default' })
  namespace: string;

  @Column({ type: 'text' })
  yamlContent: string;

  @Column({ type: 'varchar', length: 50, default: 'pending' })
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
