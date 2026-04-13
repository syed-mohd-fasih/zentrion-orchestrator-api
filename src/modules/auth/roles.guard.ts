/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SetMetadata } from '@nestjs/common';

/** Metadata key under which `@Roles(...)` stores the required roles list. */
export const ROLES_KEY = 'roles';

/**
 * Decorator attaching a required-role list to a controller or handler.
 *
 * Example: `@Roles('ADMIN')` on a route means only admins can call it.
 *
 * @param roles One or more role names (`ADMIN`, `ANALYST`, `VIEWER`).
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

/**
 * RBAC guard.
 *
 * Reads the `@Roles(...)` metadata off the handler (or, if absent, off the
 * controller class) and permits the request when `req.user.role` matches
 * any of the required roles. Routes without `@Roles` are treated as open
 * to any authenticated user — this guard should therefore always sit
 * behind `JwtAuthGuard` so `req.user` is populated.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  /**
   * Resolve the required roles for the current handler and check whether
   * the authenticated user's role satisfies them.
   *
   * @param context Nest execution context carrying the HTTP request.
   * @returns `true` if the user is authorized (or no roles are required),
   *          `false` otherwise.
   */
  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No `@Roles(...)` metadata → route is open to any authenticated user.
    if (!requiredRoles) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    return requiredRoles.some((role) => user?.role === role);
  }
}
