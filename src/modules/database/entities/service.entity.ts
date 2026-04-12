import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from 'typeorm';

@Entity('services')
@Index(['name'])
@Index(['namespace'])
export class Service {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  name: string;

  @Column({ type: 'varchar', length: 255 })
  namespace: string;

  @Column({ type: 'jsonb', nullable: true })
  labels: Record<string, string>;

  @Column({ type: 'text', array: true, default: '{}' })
  dependencies: string[];

  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  firstSeen: Date;

  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  lastSeen: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
