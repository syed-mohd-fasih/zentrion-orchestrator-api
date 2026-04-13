import { Controller, Get } from '@nestjs/common';

/**
 * Health-check controller.
 *
 * Exposes `GET /health` for Kubernetes liveness/readiness probes and for
 * external monitoring. The endpoint does not touch the database or any
 * downstream system — it only confirms the HTTP server is responsive.
 */
@Controller('health')
export class HealthController {
  /**
   * Returns a static health payload with timestamp, service name, and version.
   *
   * Intentionally cheap so probes stay fast and do not cascade failures from
   * dependencies (DB, K8s API) into pod restarts.
   *
   * @returns Object with `status`, ISO `timestamp`, `service`, and `version`.
   */
  @Get()
  check() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'orchestrator-api',
      version: '1.0.0',
    };
  }
}
