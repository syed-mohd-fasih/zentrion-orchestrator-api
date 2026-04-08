import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { TelemetryService } from './telemetry.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('telemetry')
@UseGuards(JwtAuthGuard)
export class TelemetryController {
  constructor(private telemetryService: TelemetryService) {}

  @Get('live')
  async getLiveLogs(
    @Query('limit') limit?: string,
    @Query('service') service?: string,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) : 100;
    return {
      logs: await this.telemetryService.getLogs(parsedLimit, service),
      timestamp: new Date().toISOString(),
    };
  }

  @Get('services')
  async getServices() {
    return {
      services: await this.telemetryService.getServices(),
      timestamp: new Date().toISOString(),
    };
  }

  @Get('services/:name')
  async getService(@Param('name') name: string) {
    return {
      service: await this.telemetryService.getService(name),
      timestamp: new Date().toISOString(),
    };
  }
}
