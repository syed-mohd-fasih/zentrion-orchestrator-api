import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from 'typeorm';

/**
 * `users` table — dashboard login accounts.
 *
 * `passwordHash` stores a bcrypt hash (never plaintext). The `role` column
 * is a string (`ADMIN` / `ANALYST` / `VIEWER`) consumed by the RBAC guard
 * to authorize routes.
 */
@Entity('users')
@Index(['username'])
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  username: string;

  @Column({ type: 'varchar', length: 255 })
  passwordHash: string;

  @Column({ type: 'varchar', length: 50 })
  role: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
