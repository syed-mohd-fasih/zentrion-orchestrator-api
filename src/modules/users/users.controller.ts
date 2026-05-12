/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Request,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { UsersService } from './users.service';
import {
  CreateUserDto,
  UpdateUserDto,
  ResetPasswordDto,
} from './users.dto';

/**
 * Admin-only user management (`/users`).
 *
 * Self-edit (own profile / password) lives on `AuthController` so the
 * `/auth/me` route family stays cohesive. This controller is strictly
 * for ADMIN management of other users.
 */
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get()
  async list() {
    return { users: await this.usersService.list() };
  }

  @Post()
  async create(@Body() dto: CreateUserDto) {
    return { user: await this.usersService.create(dto) };
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Request() req,
    @Body() dto: UpdateUserDto,
  ) {
    return {
      user: await this.usersService.update(id, req.user.id, dto),
    };
  }

  @Post(':id/reset-password')
  @HttpCode(200)
  async resetPassword(
    @Param('id') id: string,
    @Body() dto: ResetPasswordDto,
  ) {
    await this.usersService.resetPassword(id, dto.password);
    return { ok: true };
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(@Param('id') id: string, @Request() req) {
    await this.usersService.delete(id, req.user.id);
    return { ok: true };
  }
}
