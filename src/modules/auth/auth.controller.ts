/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/require-await */
import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Request,
  HttpCode,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { IsString, IsNotEmpty } from 'class-validator';

/**
 * Request body for `POST /auth/login`.
 *
 * Validated by the global `ValidationPipe`. `whitelist: true` ensures no
 * extra fields bleed through to the service layer.
 */
class LoginDto {
  @IsString()
  @IsNotEmpty()
  username: string;

  @IsString()
  @IsNotEmpty()
  password: string;
}

/**
 * Authentication controller (`/auth`).
 *
 * Exposes the three login-related endpoints consumed by the dashboard:
 *  - `POST /auth/login`   — exchange credentials for a JWT.
 *  - `GET  /auth/me`      — return the current user's profile.
 *  - `POST /auth/logout`  — invalidate the current access token.
 */
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  /**
   * Exchange username/password for a signed JWT.
   *
   * Returns HTTP 200 (not the default 201) because this is a lookup, not a
   * resource creation.
   *
   * @param loginDto Validated credentials payload.
   * @returns `{ accessToken, user }` on success.
   * @throws `UnauthorizedException` on invalid credentials (raised from service).
   */
  @Post('login')
  @HttpCode(200)
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto.username, loginDto.password);
  }

  /**
   * Return the authenticated user's profile (minus the password hash).
   *
   * The user is attached to `req` by `JwtStrategy.validate()` after the
   * `JwtAuthGuard` verifies the bearer token.
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getProfile(@Request() req) {
    // Strip `passwordHash` before returning — never ship credentials over the wire.
    const { passwordHash, ...userWithoutPassword } = req.user;
    return {
      user: userWithoutPassword,
    };
  }

  /**
   * Invalidate the caller's access token (in-memory session map).
   *
   * NOTE: because the session map is in-memory, logout does not survive a
   * pod restart. Acceptable for FYP scope; a production build would back
   * this with Redis or use short-lived tokens + a blacklist.
   */
  @Post('logout')
  @UseGuards(JwtAuthGuard)
  async logout(@Request() req) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    return this.authService.logout(token);
  }
}
