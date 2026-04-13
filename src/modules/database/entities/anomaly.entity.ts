import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from 'typeorm';

/**
 * `anomalies` table — one row per detected anomaly.
 *
 * Produced by the anomaly detection service (rule-based detectors operating
 * over `TelemetryLog`). Mirrored into `AnomalyRecord` CRDs so the anomaly is
 * visible both in the dashboard and via `kubectl get anomalyrecords`.
 *
 * Indexed by `service`, `type`, `severity`, and `timestamp` because those
 * are the common dashboard filters (and drive the severity-based policy
 * auto-generation threshold).
 */
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
  timestamp: Date;

  @Column({ type: 'varchar', length: 255 })
  service: string;

  @Column({ type: 'varchar', length: 100 })
  type: string;

  @Column({ type: 'varchar', length: 20 })
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
