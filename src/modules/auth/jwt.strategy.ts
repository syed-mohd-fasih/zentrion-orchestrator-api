import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../database/entities/user.entity';
import { JwtPayload } from '../../common/types';

/**
 * Passport JWT strategy.
 *
 * Extracts the bearer token from the `Authorization` header, verifies the
 * signature against `jwt.secret`, and (via `validate`) looks up the backing
 * user. The return value of `validate` is attached as `req.user` on guarded
 * routes.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    @InjectRepository(User)
    private userRepo: Repository<User>,
  ) {
    const jwtSecret = configService.get<string>('jwt.secret');
    if (!jwtSecret) {
      // Refuse to boot rather than silently accept unsigned tokens.
      throw new Error('JWT secret is not defined in configuration');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtSecret,
    });
  }

  /**
   * Invoked by Passport after the signature check.
   *
   * Looks up the user referenced by the token's `sub` claim so downstream
   * handlers receive a fresh `User` entity (rather than trusting claims
   * that may be stale relative to DB state).
   *
   * @param payload Verified JWT payload.
   * @returns The hydrated `User` (attached as `req.user`).
   * @throws `UnauthorizedException` if the user has since been deleted.
   */
  async validate(payload: JwtPayload) {
    const user = await this.userRepo.findOne({ where: { id: payload.sub } });
    if (!user) throw new UnauthorizedException('User not found');
    return user;
  }
}
