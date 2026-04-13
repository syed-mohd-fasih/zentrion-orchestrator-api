import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from 'typeorm';

/**
 * `telemetry_logs` table — individual request records parsed from Envoy
 * access logs.
 *
 * This is the high-volume table that the anomaly engine scans. `sourceIp`
 * uses the Postgres `inet` type for efficient IP filtering, and the four
 * indexes (`service`, `timestamp`, `status`, `source`) cover the detector
 * queries (per-service windows, error-rate scans, source enumeration).
 */
@Entity('telemetry_logs')
@Index(['service'])
@Index(['timestamp'])
@Index(['status'])
@Index(['source'])
export class TelemetryLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'timestamptz' })
  timestamp: Date;

  @Column({ type: 'varchar', length: 255 })
  source: string;

  @Column({ type: 'inet' })
  sourceIp: string;

  @Column({ type: 'varchar', length: 10 })
  method: string;

  @Column({ type: 'text' })
  path: string;

  @Column({ type: 'integer' })
  status: number;

  @Column({ type: 'integer' })
  latencyMs: number;

  @Column({ type: 'varchar', length: 255 })
  service: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  destService: string;

  @Column({ type: 'text', nullable: true })
  userAgent: string;

  @Column({ type: 'integer', nullable: true })
  requestSize: number;

  @Column({ type: 'integer', nullable: true })
  responseSize: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
