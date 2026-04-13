import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { TelemetryService } from './telemetry.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

/**
 * Telemetry HTTP API (`/telemetry`).
 *
 * Read-only endpoints backing the dashboard's live-logs and service-topology
 * views. Writes happen asynchronously via the event bus
 * (`telemetry.log` events from `IstioService` → `TelemetryService`), so
 * this controller never accepts POSTs.
 *
 * All routes require a valid JWT — no anonymous access.
 */
@Controller('telemetry')
@UseGuards(JwtAuthGuard)
export class TelemetryController {
  constructor(private telemetryService: TelemetryService) {}

  /**
   * `GET /telemetry/live` — latest telemetry logs.
   *
   * @param limit   Max rows to return (query string, defaults to 100).
   * @param service Optional service filter.
   * @returns `{ logs, timestamp }`.
   */
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

  /**
   * `GET /telemetry/services` — every discovered service decorated with
   * live per-service metrics (RPS, error rate, avg latency).
   */
  @Get('services')
  async getServices() {
    return {
      services: await this.telemetryService.getServices(),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * `GET /telemetry/services/:name` — one service's stored record.
   * Returns `service: null` when the name is unknown.
   */
  @Get('services/:name')
  async getService(@Param('name') name: string) {
    return {
      service: await this.telemetryService.getService(name),
      timestamp: new Date().toISOString(),
    };
  }
}
