import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../database/entities/user.entity';
import { JwtPayload } from '../../common/types';

/**
 * Authentication service.
 *
 * Owns credential validation, JWT issuance, and the (in-memory) active
 * session map. The session map is purely a best-effort logout mechanism —
 * JWT signatures are still the source of truth for authentication, so a
 * token whose session entry has been cleared by a restart remains valid
 * until it expires. See the discussion in CLAUDE.md under "Known Issues".
 */
@Injectable()
export class AuthService {
  /** token → userId map populated on login, cleared on logout/restart. */
  private sessions = new Map<string, string>();

  constructor(
    private jwtService: JwtService,
    @InjectRepository(User)
    private userRepo: Repository<User>,
  ) {}

  /**
   * Look up a user by username and verify the supplied password against
   * the stored bcrypt hash.
   *
   * @param username Login username.
   * @param password Plaintext password supplied by the client.
   * @returns The `User` entity on success, or `null` if the user does not
   *          exist or the password does not match.
   */
  async validateUser(username: string, password: string): Promise<User | null> {
    const user = await this.userRepo.findOne({ where: { username } });
    if (!user) return null;
    const valid = await bcrypt.compare(password, user.passwordHash);
    return valid ? user : null;
  }

  /**
   * Validate credentials and mint a signed JWT.
   *
   * The issued token embeds `sub` (user id), `username`, and `role` so the
   * RBAC guard can authorize requests without another DB lookup.
   *
   * @throws `UnauthorizedException` if the credentials are wrong.
   */
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

  /**
   * Verify a JWT's signature + expiry and load the backing user.
   *
   * @returns The `User` referenced by `sub`, or `null` if the token is
   *          invalid, expired, or the user no longer exists.
   */
  async validateToken(token: string): Promise<User | null> {
    try {
      const payload = this.jwtService.verify(token) as JwtPayload;
      return await this.userRepo.findOne({ where: { id: payload.sub } });
    } catch {
      return null;
    }
  }

  /**
   * Strict variant of `validateToken` that throws instead of returning null.
   *
   * Use this in callers that cannot proceed without an authenticated user.
   *
   * @throws `UnauthorizedException` when the token is invalid or expired.
   */
  async getUserFromToken(token: string): Promise<User> {
    const user = await this.validateToken(token);
    if (!user) throw new UnauthorizedException('Invalid or expired token');
    return user;
  }

  /** Fetch a user by primary key. Returns `null` if not found. */
  async getUserById(id: string): Promise<User | null> {
    return this.userRepo.findOne({ where: { id } });
  }

  /**
   * Drop a token from the in-memory session map.
   *
   * Does NOT invalidate the JWT itself — the signature stays valid until
   * expiry. Acceptable for FYP scope.
   */
  logout(token: string) {
    this.sessions.delete(token);
    return { message: 'Logged out successfully' };
  }
}
