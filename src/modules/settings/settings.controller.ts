import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { IsString, IsNotEmpty } from 'class-validator';
import { SettingsService } from './settings.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/roles.guard';

class UpdateSettingDto {
  @IsString()
  @IsNotEmpty()
  key: string;

  @IsString()
  @IsNotEmpty()
  value: string;
}

@Controller('settings')
@UseGuards(JwtAuthGuard)
export class SettingsController {
  constructor(private settingsService: SettingsService) {}

  @Get()
  async getAll() {
    return {
      settings: await this.settingsService.getAll(),
      timestamp: new Date().toISOString(),
    };
  }

  @Patch()
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async update(@Body() dto: UpdateSettingDto) {
    const setting = await this.settingsService.update(dto.key, dto.value);
    return {
      setting,
      timestamp: new Date().toISOString(),
    };
  }
}
