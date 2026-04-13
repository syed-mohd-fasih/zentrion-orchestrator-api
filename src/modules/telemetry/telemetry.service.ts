import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { OnEvent } from '@nestjs/event-emitter';
import { TelemetryLog } from '../database/entities/telemetry-log.entity';
import { Service } from '../database/entities/service.entity';
import { v4 as uuidv4 } from 'uuid';

/**
 * Telemetry service — Envoy log persistence and query layer.
 *
 * Subscribes to the `telemetry.log` event published by `IstioService`,
 * normalises the payload (Envoy JSON and text formats use different field
 * names), and saves it as a `TelemetryLog` row. The WebSocket gateway
 * registers a callback via `setEventEmitter` so newly persisted logs can
 * be broadcast live to the dashboard without a tight dependency.
 *
 * Also exposes a handful of read APIs: `getLogs`, `getServices` (with
 * per-service metrics), and `computeServiceMetrics` (RPS / error rate /
 * avg latency over the last hour).
 */
@Injectable()
export class TelemetryService {
  private readonly logger = new Logger(TelemetryService.name);
  /** Optional callback wired up by the WebSocket gateway. */
  private eventEmitter: ((event: string, data: any) => void) | null = null;

  constructor(
    @InjectRepository(TelemetryLog)
    private logRepo: Repository<TelemetryLog>,
    @InjectRepository(Service)
    private serviceRepo: Repository<Service>,
  ) {}

  /**
   * Register the WebSocket emitter callback. Called exactly once by
   * `TelemetryGateway.afterInit`.
   */
  setEventEmitter(emitter: (event: string, data: any) => void) {
    this.eventEmitter = emitter;
  }

  /**
   * Handler for `telemetry.log` events from the Istio watcher.
   *
   * Tolerant to multiple field spellings because Envoy's JSON access log
   * schema differs from the text format and from the normalized form
   * produced by `IstioService.parseEnvoyTextLog`. Failures are logged and
   * swallowed — one bad log line must never crash the listener.
   */
  @OnEvent('telemetry.log')
  async handleTelemetryLog(data: Record<string, any>) {
    try {
      const log = new TelemetryLog();
      log.id = uuidv4();
      log.timestamp = data.timestamp ? new Date(data.timestamp) : new Date();
      log.source = data.source_service || data.source || data.pod || 'unknown';
      log.sourceIp = data.source_ip || data.sourceIp || data.x_forwarded_for || '0.0.0.0';
      log.method = data.method || 'GET';
      log.path = data.path || data.url_path || '/';
      log.status = parseInt(String(data.response_code || data.status || '200'), 10);
      log.latencyMs = parseInt(String(data.duration || data.latency_ms || data.latencyMs || '0'), 10);
      log.service = data.destination_service || data.service || data.pod || 'unknown';
      log.destService = data.upstream_cluster || data.destService || null;
      log.userAgent = data.user_agent || data.userAgent || null;
      log.requestSize = parseInt(String(data.bytes_received || data.requestSize || '0'), 10);
      log.responseSize = parseInt(String(data.bytes_sent || data.responseSize || '0'), 10);

      await this.logRepo.save(log);

      if (this.eventEmitter) {
        this.eventEmitter('telemetry.log', log);
      }
    } catch (error) {
      this.logger.error(`Failed to save telemetry log: ${(error as Error).message}`);
    }
  }

  /**
   * Read the most recent telemetry logs, optionally filtered by service.
   *
   * @param limit   Max rows (default 100).
   * @param service Optional service filter.
   */
  async getLogs(limit = 100, service?: string): Promise<TelemetryLog[]> {
    const query = this.logRepo
      .createQueryBuilder('log')
      .orderBy('log.timestamp', 'DESC')
      .take(limit);

    if (service) {
      query.where('log.service = :service', { service });
    }

    return query.getMany();
  }

  /**
   * Return every service in the `services` table, each decorated with live
   * metrics (RPS, error rate, avg latency) computed from the past hour of
   * telemetry.
   */
  async getServices(): Promise<(Service & { requestsPerSecond: number; errorRate: number; avgLatency: number })[]> {
    const services = await this.serviceRepo.find({ order: { name: 'ASC' } });

    return Promise.all(
      services.map(async (svc) => {
        const metrics = await this.computeServiceMetrics(svc.name);
        return { ...svc, ...metrics };
      }),
    );
  }

  /** Fetch a single service by name. Returns `null` if unknown. */
  async getService(name: string): Promise<Service | null> {
    return this.serviceRepo.findOne({ where: { name } });
  }

  /** Public wrapper for `computeServiceMetrics`. */
  async getServiceMetrics(service: string) {
    return this.computeServiceMetrics(service);
  }

  /**
   * Compute per-service traffic metrics over the last hour:
   *  - `requestsPerSecond` — request count divided by 3600s.
   *  - `errorRate`         — percentage of 4xx/5xx responses.
   *  - `avgLatency`        — mean `latencyMs`, rounded.
   *
   * All three are returned even when the service has no traffic
   * (zeros rather than `NaN`) so the dashboard never renders undefined.
   */
  private async computeServiceMetrics(service: string) {
    const oneHourAgo = new Date(Date.now() - 3_600_000);

    const result = await this.logRepo
      .createQueryBuilder('log')
      .select('COUNT(*)', 'total')
      .addSelect('SUM(CASE WHEN log.status >= 400 THEN 1 ELSE 0 END)', 'errors')
      .addSelect('AVG(log."latencyMs")', 'avgLatency')
      .where('log.service = :service', { service })
      .andWhere('log.timestamp > :since', { since: oneHourAgo })
      .getRawOne<{ total: string; errors: string; avgLatency: string }>();

    const total = parseInt(result?.total || '0', 10);
    const errors = parseInt(result?.errors || '0', 10);

    return {
      requestsPerSecond: parseFloat((total / 3600).toFixed(2)),
      // `total || 1` guards against division-by-zero for silent services.
      errorRate: parseFloat(((errors / (total || 1)) * 100).toFixed(2)),
      avgLatency: Math.round(parseFloat(result?.avgLatency || '0')),
    };
  }
}
