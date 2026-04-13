import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AnomalyService } from './anomaly.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

/**
 * Anomaly HTTP API (`/anomalies`).
 *
 * Read-only — anomalies are written only by the background detector loop.
 * All routes are JWT-protected.
 */
@Controller('anomalies')
@UseGuards(JwtAuthGuard)
export class AnomalyController {
  constructor(private anomalyService: AnomalyService) {}

  /**
   * `GET /anomalies` — latest anomalies across all services.
   *
   * @param limit Optional page size (defaults to service-side default).
   */
  @Get()
  async getAllAnomalies(@Query('limit') limit?: string) {
    const parsedLimit = limit ? parseInt(limit, 10) : undefined;
    return {
      anomalies: await this.anomalyService.getAllAnomalies(parsedLimit),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * `GET /anomalies/service/:service` — anomalies scoped to one service.
   */
  @Get('service/:service')
  async getAnomaliesByService(@Param('service') service: string) {
    return {
      anomalies: await this.anomalyService.getAnomaliesByService(service),
      service,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * `GET /anomalies/:id` — single anomaly by its `anomalyId` UUID.
   */
  @Get(':id')
  async getAnomaly(@Param('id') id: string) {
    return {
      anomaly: await this.anomalyService.getAnomaly(id),
      timestamp: new Date().toISOString(),
    };
  }
}
