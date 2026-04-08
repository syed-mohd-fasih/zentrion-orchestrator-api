import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from 'typeorm';

@Entity('telemetry_logs')
@Index(['service'])
@Index(['timestamp'])
@Index(['status'])
export class TelemetryLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'timestamptz' })
  @Index()
  timestamp: Date;

  @Column({ type: 'varchar', length: 255 })
  @Index()
  source: string;

  @Column({ type: 'inet' })
  sourceIp: string;

  @Column({ type: 'varchar', length: 10 })
  method: string;

  @Column({ type: 'text' })
  path: string;

  @Column({ type: 'integer' })
  @Index()
  status: number;

  @Column({ type: 'integer' })
  latencyMs: number;

  @Column({ type: 'varchar', length: 255 })
  @Index()
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
