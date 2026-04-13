import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from 'typeorm';

/**
 * `policy_history` table — append-only audit log of policy lifecycle actions.
 *
 * One row per transition (`created`, `approved`, `rejected`, `applied`,
 * `deleted`). Rows are never updated or deleted in normal flow, so this
 * table satisfies the audit-trail requirement for the FYP evaluation and is
 * mirrored into `PolicyHistory` CRDs for K8s-native inspection.
 */
@Entity('policy_history')
@Index(['policyId'])
@Index(['timestamp'])
export class PolicyHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  policyId: string;

  @Column({ type: 'varchar', length: 50 })
  action: string;

  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  timestamp: Date;

  @Column({ type: 'varchar', length: 255 })
  userId: string;

  @Column({ type: 'text' })
  details: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>;
}
