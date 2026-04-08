import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AnomalyService } from './anomaly.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('anomalies')
@UseGuards(JwtAuthGuard)
export class AnomalyController {
  constructor(private anomalyService: AnomalyService) {}

  @Get()
  async getAllAnomalies(@Query('limit') limit?: string) {
    const parsedLimit = limit ? parseInt(limit, 10) : undefined;
    return {
      anomalies: await this.anomalyService.getAllAnomalies(parsedLimit),
      timestamp: new Date().toISOString(),
    };
  }

  @Get('service/:service')
  async getAnomaliesByService(@Param('service') service: string) {
    return {
      anomalies: await this.anomalyService.getAnomaliesByService(service),
      service,
      timestamp: new Date().toISOString(),
    };
  }

  @Get(':id')
  async getAnomaly(@Param('id') id: string) {
    return {
      anomaly: await this.anomalyService.getAnomaly(id),
      timestamp: new Date().toISOString(),
    };
  }
}
