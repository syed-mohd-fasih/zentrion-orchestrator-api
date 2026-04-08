import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { OnEvent } from '@nestjs/event-emitter';
import { TelemetryLog } from '../database/entities/telemetry-log.entity';
import { Service } from '../database/entities/service.entity';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class TelemetryService {
  private readonly logger = new Logger(TelemetryService.name);
  private eventEmitter: ((event: string, data: any) => void) | null = null;

  constructor(
    @InjectRepository(TelemetryLog)
    private logRepo: Repository<TelemetryLog>,
    @InjectRepository(Service)
    private serviceRepo: Repository<Service>,
  ) {}

  setEventEmitter(emitter: (event: string, data: any) => void) {
    this.eventEmitter = emitter;
  }

  /**
   * Handle telemetry event emitted by IstioService
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

  async getServices(): Promise<(Service & { requestsPerSecond: number; errorRate: number; avgLatency: number })[]> {
    const services = await this.serviceRepo.find({ order: { name: 'ASC' } });

    return Promise.all(
      services.map(async (svc) => {
        const metrics = await this.computeServiceMetrics(svc.name);
        return { ...svc, ...metrics };
      }),
    );
  }

  async getService(name: string): Promise<Service | null> {
    return this.serviceRepo.findOne({ where: { name } });
  }

  async getServiceMetrics(service: string) {
    return this.computeServiceMetrics(service);
  }

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
      errorRate: parseFloat(((errors / (total || 1)) * 100).toFixed(2)),
      avgLatency: Math.round(parseFloat(result?.avgLatency || '0')),
    };
  }
}
