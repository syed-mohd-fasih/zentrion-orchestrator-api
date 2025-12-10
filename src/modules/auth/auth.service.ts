/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/require-await */
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { store } from '../../common/store';
import { User, JwtPayload } from '../../common/types';

@Injectable()
export class AuthService {
  constructor(private jwtService: JwtService) {}

  async validateUser(username: string, password: string): Promise<User | null> {
    const user = store.getUserByUsername(username);

    if (!user) {
      return null;
    }

    // In production, use bcrypt.compare()
    // For now, simple comparison (passwords seeded as plain text)
    if (user.password === password) {
      return user;
    }

    return null;
  }

  async login(username: string, password: string) {
    const user = await this.validateUser(username, password);

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload: JwtPayload = {
      sub: user.id,
      username: user.username,
      role: user.role,
    };

    const accessToken = this.jwtService.sign(payload);

    // Store session
    store.addSession(accessToken, user.id);

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
      const user = store.getUser(payload.sub);
      return user || null;
    } catch {
      return null;
    }
  }

  async getUserFromToken(token: string): Promise<User> {
    const user = await this.validateToken(token);
    if (!user) {
      throw new UnauthorizedException('Invalid or expired token');
    }
    return user;
  }

  logout(token: string) {
    store.removeSession(token);
    return { message: 'Logged out successfully' };
  }
}
