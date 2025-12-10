import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AnomalyService } from './anomaly.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('anomalies')
@UseGuards(JwtAuthGuard)
export class AnomalyController {
  constructor(private anomalyService: AnomalyService) {}

  @Get()
  getAllAnomalies(@Query('limit') limit?: string) {
    const parsedLimit = limit ? parseInt(limit, 10) : undefined;
    return {
      anomalies: this.anomalyService.getAllAnomalies(parsedLimit),
      timestamp: new Date().toISOString(),
    };
  }

  @Get(':id')
  getAnomaly(@Param('id') id: string) {
    const anomaly = this.anomalyService.getAnomaly(id);
    return {
      anomaly,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('service/:service')
  getAnomaliesByService(@Param('service') service: string) {
    return {
      anomalies: this.anomalyService.getAnomaliesByService(service),
      service,
      timestamp: new Date().toISOString(),
    };
  }
}
