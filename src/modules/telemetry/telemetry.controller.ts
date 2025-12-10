import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { TelemetryService } from './telemetry.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('telemetry')
@UseGuards(JwtAuthGuard)
export class TelemetryController {
  constructor(private telemetryService: TelemetryService) {}

  @Get('live')
  getLiveLogs(
    @Query('limit') limit?: string,
    @Query('service') service?: string,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) : 100;
    return {
      logs: this.telemetryService.getLogs(parsedLimit, service),
      timestamp: new Date().toISOString(),
    };
  }

  @Get('services')
  getServices() {
    return {
      services: this.telemetryService.getServices(),
      timestamp: new Date().toISOString(),
    };
  }

  @Get('services/:name')
  getService(@Query('name') name: string) {
    const service = this.telemetryService.getService(name);
    return {
      service,
      timestamp: new Date().toISOString(),
    };
  }
}
