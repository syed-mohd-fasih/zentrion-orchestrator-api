import { Controller, Get, Param, Post, Patch, Query, UseGuards, Request, NotFoundException } from '@nestjs/common';
import { AnomalyService } from './anomaly.service';
import { PolicyService } from '../policy/policy.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/roles.guard';

@Controller('anomalies')
@UseGuards(JwtAuthGuard)
export class AnomalyController {
  constructor(
    private anomalyService: AnomalyService,
    private policyService: PolicyService,
  ) {}

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

  /** `PATCH /anomalies/:id/resolve` — mark anomaly as resolved. */
  @Patch(':id/resolve')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ANALYST')
  async resolveAnomaly(@Param('id') id: string) {
    const anomaly = await this.anomalyService.resolveAnomaly(id);
    return { anomaly, timestamp: new Date().toISOString() };
  }

  /** `PATCH /anomalies/:id/whitelist` — mark anomaly as false positive. */
  @Patch(':id/whitelist')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ANALYST')
  async whitelistAnomaly(@Param('id') id: string) {
    const anomaly = await this.anomalyService.whitelistAnomaly(id);
    return { anomaly, timestamp: new Date().toISOString() };
  }

  /**
   * `POST /anomalies/:id/block-ip` — generate a policy draft that blocks
   * the source IP associated with this anomaly.
   */
  @Post(':id/block-ip')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ANALYST')
  async blockSourceIp(@Param('id') id: string, @Request() req) {
    const anomaly = await this.anomalyService.getAnomaly(id);
    if (!anomaly) throw new NotFoundException(`Anomaly ${id} not found`);
    const draft = await this.policyService.generatePolicyFromAnomaly(anomaly.anomalyId, req.user.id as string);
    return { draft, message: 'Policy draft created to block source IP', timestamp: new Date().toISOString() };
  }
}
