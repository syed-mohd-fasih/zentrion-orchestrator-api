import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../database/entities/user.entity';
import { JwtPayload } from '../../common/types';

@Injectable()
export class AuthService {
  private sessions = new Map<string, string>(); // token → userId

  constructor(
    private jwtService: JwtService,
    @InjectRepository(User)
    private userRepo: Repository<User>,
  ) {}

  async validateUser(username: string, password: string): Promise<User | null> {
    const user = await this.userRepo.findOne({ where: { username } });
    if (!user) return null;
    const valid = await bcrypt.compare(password, user.passwordHash);
    return valid ? user : null;
  }

  async login(username: string, password: string) {
    const user = await this.validateUser(username, password);
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const payload: JwtPayload = {
      sub: user.id,
      username: user.username,
      role: user.role,
    };

    const accessToken = this.jwtService.sign(payload);
    this.sessions.set(accessToken, user.id);

    return {
      accessToken,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        email: user.email,
      },
    };
  }

  async validateToken(token: string): Promise<User | null> {
    try {
      const payload = this.jwtService.verify(token) as JwtPayload;
      return await this.userRepo.findOne({ where: { id: payload.sub } });
    } catch {
      return null;
    }
  }

  async getUserFromToken(token: string): Promise<User> {
    const user = await this.validateToken(token);
    if (!user) throw new UnauthorizedException('Invalid or expired token');
    return user;
  }

  async getUserById(id: string): Promise<User | null> {
    return this.userRepo.findOne({ where: { id } });
  }

  logout(token: string) {
    this.sessions.delete(token);
    return { message: 'Logged out successfully' };
  }
}
