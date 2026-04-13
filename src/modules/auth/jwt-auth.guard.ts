/* eslint-disable @typescript-eslint/no-unsafe-call */
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Thin wrapper around Passport's `AuthGuard('jwt')`.
 *
 * Applying `@UseGuards(JwtAuthGuard)` to a route delegates to `JwtStrategy`
 * to verify the `Authorization: Bearer <token>` header and attach the
 * resolved `User` onto `req.user`. Exists as its own class so controllers
 * can reference a stable name and future cross-cutting behaviour (rate
 * limiting, audit logging) can be added in one place.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
