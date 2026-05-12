import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../database/entities/user.entity';
import { CreateUserDto, UpdateUserDto } from './users.dto';
import { AuthService } from '../auth/auth.service';

export type PublicUser = Omit<User, 'passwordHash'>;

const BCRYPT_COST = 10;

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User)
    private userRepo: Repository<User>,
    @Inject(forwardRef(() => AuthService))
    private authService: AuthService,
  ) {}

  async list(): Promise<PublicUser[]> {
    const users = await this.userRepo.find({ order: { createdAt: 'ASC' } });
    return users.map(({ passwordHash, ...rest }) => rest);
  }

  async create(dto: CreateUserDto): Promise<PublicUser> {
    const existing = await this.userRepo.findOne({ where: { username: dto.username } });
    if (existing) {
      throw new ConflictException(`Username "${dto.username}" is already taken`);
    }

    const salt = await bcrypt.genSalt(BCRYPT_COST);
    const passwordHash = await bcrypt.hash(dto.password, salt);

    const user = this.userRepo.create({
      username: dto.username,
      passwordHash,
      role: dto.role,
      email: dto.email ?? null,
      firstLogin: true,
    });
    await this.userRepo.save(user);
    this.logger.log(`User created: ${user.username} (${user.role})`);

    const { passwordHash: _omit, ...publicUser } = user;
    return publicUser;
  }

  async update(id: string, callerId: string, dto: UpdateUserDto): Promise<PublicUser> {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException(`User ${id} not found`);

    // Self-role-change guard: an admin can't change their OWN role here
    // (avoids accidentally locking yourself out by demoting yourself).
    if (id === callerId && dto.role !== undefined && dto.role !== user.role) {
      throw new BadRequestException("You can't change your own role");
    }

    // Last-admin guard: refuse demoting the last remaining ADMIN.
    if (
      dto.role !== undefined &&
      dto.role !== 'ADMIN' &&
      user.role === 'ADMIN'
    ) {
      const otherAdmins = await this.userRepo.count({
        where: { role: 'ADMIN', id: Not(id) },
      });
      if (otherAdmins === 0) {
        throw new BadRequestException(
          'Cannot demote the last remaining ADMIN — promote another user first',
        );
      }
    }

    if (dto.username && dto.username !== user.username) {
      const taken = await this.userRepo.findOne({ where: { username: dto.username } });
      if (taken) {
        throw new ConflictException(`Username "${dto.username}" is already taken`);
      }
      user.username = dto.username;
    }
    if (dto.email !== undefined) user.email = dto.email || null;
    if (dto.role !== undefined) user.role = dto.role;

    await this.userRepo.save(user);
    this.logger.log(`User updated: ${user.username} (${user.role})`);

    const { passwordHash: _omit, ...publicUser } = user;
    return publicUser;
  }

  async resetPassword(id: string, newPassword: string): Promise<void> {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException(`User ${id} not found`);

    const salt = await bcrypt.genSalt(BCRYPT_COST);
    user.passwordHash = await bcrypt.hash(newPassword, salt);
    await this.userRepo.save(user);

    // Invalidate any active sessions so the user is forced to log in fresh.
    this.authService.clearSessionsForUser(id);
    this.logger.log(`Password reset for user: ${user.username}`);
  }

  async delete(id: string, callerId: string): Promise<void> {
    if (id === callerId) {
      throw new BadRequestException("You can't delete yourself");
    }
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException(`User ${id} not found`);

    // Don't let the last admin be deleted.
    if (user.role === 'ADMIN') {
      const otherAdmins = await this.userRepo.count({
        where: { role: 'ADMIN', id: Not(id) },
      });
      if (otherAdmins === 0) {
        throw new BadRequestException(
          'Cannot delete the last remaining ADMIN',
        );
      }
    }

    await this.userRepo.delete({ id });
    this.authService.clearSessionsForUser(id);
    this.logger.log(`User deleted: ${user.username}`);
  }
}
