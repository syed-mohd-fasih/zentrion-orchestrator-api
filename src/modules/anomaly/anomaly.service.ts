import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Anomaly } from '../database/entities/anomaly.entity';
import { TelemetryLog } from '../database/entities/telemetry-log.entity';
import { AnomalyType, AnomalySeverity } from '../../common/types';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class AnomalyService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnomalyService.name);
  private detectionInterval: NodeJS.Timeout;
  private eventEmitter: ((event: string, data: any) => void) | null = null;

  // Known suspicious IPs (used for UNUSUAL_SOURCE detection)
  private readonly SUSPICIOUS_IPS = new Set([
    '192.0.2.1',
    '198.51.100.42',
    '203.0.113.99',
  ]);

  // Known allowed service-to-service communications
  private readonly KNOWN_COMMUNICATIONS = new Set([
    'frontend->api-gateway',
    'api-gateway->auth-service',
    'api-gateway->payment-service',
    'api-gateway->inventory-service',
    'payment-service->billing-service',
    'inventory-service->notification-service',
  ]);

  constructor(
    @InjectRepository(Anomaly)
    private anomalyRepo: Repository<Anomaly>,
    @InjectRepository(TelemetryLog)
    private logRepo: Repository<TelemetryLog>,
    private configService: ConfigService,
  ) {}

  onModuleInit() {
    this.startDetection();
  }

  onModuleDestroy() {
    if (this.detectionInterval) {
      clearInterval(this.detectionInterval);
    }
  }

  setEventEmitter(emitter: (event: string, data: any) => void) {
    this.eventEmitter = emitter;
  }

  private startDetection() {
    const interval = this.configService.get<number>('anomaly.detectionIntervalMs', 5000);
    this.detectionInterval = setInterval(() => {
      this.runDetection().catch((err: Error) =>
        this.logger.error(`Detection error: ${err.message}`),
      );
    }, interval);
    this.logger.log(`Anomaly detection started (interval: ${interval}ms)`);
  }

  private async runDetection() {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    const recentLogs = await this.logRepo.find({
      where: { timestamp: MoreThan(fiveMinutesAgo) },
      order: { timestamp: 'DESC' },
      take: 200,
    });

    if (recentLogs.length === 0) return;

    const detectionChecks: Array<() => Anomaly | null> = [
      () => this.detectUnusualSource(recentLogs),
      () => this.detectUnexpectedCommunication(recentLogs),
      () => this.detectNewEndpoint(recentLogs),
      () => this.detectHighErrorRate(recentLogs),
      () => this.detectTrafficSpike(recentLogs),
      () => this.detectSuspiciousPattern(recentLogs),
      () => this.detectLatencyAnomaly(recentLogs),
      () => this.detectUnauthorizedAccess(recentLogs),
    ];

    for (const check of detectionChecks) {
      try {
        const anomaly = check();
        if (anomaly) {
          await this.anomalyRepo.save(anomaly);
          this.logger.warn(`Anomaly detected: ${anomaly.type} on ${anomaly.service}`);

          if (this.eventEmitter) {
            this.eventEmitter('anomaly.created', anomaly);
          }
        }
      } catch (error) {
        this.logger.error(`Detection rule error: ${(error as Error).message}`);
      }
    }
  }

  private detectUnusualSource(logs: TelemetryLog[]): Anomaly | null {
    for (const log of logs.slice(0, 50)) {
      if (this.SUSPICIOUS_IPS.has(log.sourceIp)) {
        return this.buildAnomaly({
          service: log.service,
          type: 'UNUSUAL_SOURCE',
          severity: 'medium',
          details: `Request from suspicious IP ${log.sourceIp} to ${log.path}`,
          associatedLogs: [log.id],
        });
      }
    }
    return null;
  }

  private detectUnexpectedCommunication(logs: TelemetryLog[]): Anomaly | null {
    for (const log of logs.slice(0, 50)) {
      if (log.destService) {
        const commKey = `${log.source}->${log.destService}`;
        if (!this.KNOWN_COMMUNICATIONS.has(commKey)) {
          return this.buildAnomaly({
            service: log.service,
            type: 'UNEXPECTED_COMMUNICATION',
            severity: 'high',
            details: `Unexpected communication: ${log.source} -> ${log.destService}`,
            associatedLogs: [log.id],
          });
        }
      }
    }
    return null;
  }

  private detectNewEndpoint(logs: TelemetryLog[]): Anomaly | null {
    // Without static baselines for real services, flag paths with unusual patterns
    for (const log of logs.slice(0, 50)) {
      const isAdminPath = log.path.includes('/admin') || log.path.includes('/.env') || log.path.includes('/config');
      if (isAdminPath && log.status !== 404) {
        return this.buildAnomaly({
          service: log.service,
          type: 'NEW_ENDPOINT',
          severity: 'medium',
          details: `Sensitive endpoint accessed: ${log.method} ${log.path} on ${log.service}`,
          associatedLogs: [log.id],
        });
      }
    }
    return null;
  }

  private detectHighErrorRate(logs: TelemetryLog[]): Anomaly | null {
    const serviceGroups = this.groupByService(logs);

    for (const [service, serviceLogs] of Object.entries(serviceGroups)) {
      if (serviceLogs.length < 10) continue;
      const errorCount = serviceLogs.filter((l) => l.status >= 400).length;
      const errorRate = (errorCount / serviceLogs.length) * 100;

      if (errorRate > 20) {
        return this.buildAnomaly({
          service,
          type: 'HIGH_ERROR_RATE',
          severity: 'high',
          details: `High error rate: ${errorRate.toFixed(1)}% (${errorCount}/${serviceLogs.length} requests)`,
          associatedLogs: serviceLogs.filter((l) => l.status >= 400).slice(0, 5).map((l) => l.id),
        });
      }
    }
    return null;
  }

  private detectTrafficSpike(logs: TelemetryLog[]): Anomaly | null {
    const serviceGroups = this.groupByService(logs);

    for (const [service, serviceLogs] of Object.entries(serviceGroups)) {
      const recentCount = serviceLogs.filter(
        (l) => l.timestamp.getTime() > Date.now() - 10_000,
      ).length;
      const baselineCount = serviceLogs.length / 20;

      if (recentCount > baselineCount * 3 && recentCount > 20) {
        return this.buildAnomaly({
          service,
          type: 'TRAFFIC_SPIKE',
          severity: 'medium',
          details: `Traffic spike: ${recentCount} requests in 10s (baseline: ~${Math.round(baselineCount)}/10s)`,
          associatedLogs: serviceLogs.slice(0, 5).map((l) => l.id),
        });
      }
    }
    return null;
  }

  private detectSuspiciousPattern(logs: TelemetryLog[]): Anomaly | null {
    const ipGroups = new Map<string, TelemetryLog[]>();

    for (const log of logs.slice(0, 100)) {
      const group = ipGroups.get(log.sourceIp) ?? [];
      group.push(log);
      ipGroups.set(log.sourceIp, group);
    }

    for (const [ip, ipLogs] of ipGroups.entries()) {
      if (ipLogs.length > 30) {
        return this.buildAnomaly({
          service: ipLogs[0].service,
          type: 'SUSPICIOUS_PATTERN',
          severity: 'high',
          details: `Suspicious activity from IP ${ip}: ${ipLogs.length} requests in short window`,
          associatedLogs: ipLogs.slice(0, 5).map((l) => l.id),
        });
      }
    }
    return null;
  }

  private detectLatencyAnomaly(logs: TelemetryLog[]): Anomaly | null {
    const serviceGroups = this.groupByService(logs);

    for (const [service, serviceLogs] of Object.entries(serviceGroups)) {
      if (serviceLogs.length < 10) continue;

      const avgLatency = serviceLogs.reduce((s, l) => s + l.latencyMs, 0) / serviceLogs.length;
      const recentLogs = serviceLogs.slice(0, 10);
      const recentAvg = recentLogs.reduce((s, l) => s + l.latencyMs, 0) / recentLogs.length;

      if (recentAvg > avgLatency * 3 && recentAvg > 200) {
        return this.buildAnomaly({
          service,
          type: 'LATENCY_ANOMALY',
          severity: 'medium',
          details: `Latency spike: ${Math.round(recentAvg)}ms recent vs ${Math.round(avgLatency)}ms baseline`,
          associatedLogs: recentLogs.map((l) => l.id),
        });
      }
    }
    return null;
  }

  private detectUnauthorizedAccess(logs: TelemetryLog[]): Anomaly | null {
    const unauthorizedLogs = logs.slice(0, 50).filter((l) => l.status === 401 || l.status === 403);

    if (unauthorizedLogs.length > 5) {
      return this.buildAnomaly({
        service: unauthorizedLogs[0].service,
        type: 'UNAUTHORIZED_ACCESS',
        severity: 'high',
        details: `${unauthorizedLogs.length} unauthorized access attempts (401/403) detected`,
        associatedLogs: unauthorizedLogs.slice(0, 5).map((l) => l.id),
      });
    }
    return null;
  }

  private groupByService(logs: TelemetryLog[]): Record<string, TelemetryLog[]> {
    return logs.reduce<Record<string, TelemetryLog[]>>((acc, log) => {
      acc[log.service] = acc[log.service] ?? [];
      acc[log.service].push(log);
      return acc;
    }, {});
  }

  private buildAnomaly(params: {
    service: string;
    type: AnomalyType;
    severity: AnomalySeverity;
    details: string;
    associatedLogs: string[];
  }): Anomaly {
    const anomaly = new Anomaly();
    anomaly.anomalyId = uuidv4();
    anomaly.timestamp = new Date();
    anomaly.service = params.service;
    anomaly.type = params.type;
    anomaly.severity = params.severity;
    anomaly.details = params.details;
    anomaly.associatedLogs = params.associatedLogs;
    anomaly.resolved = false;
    return anomaly;
  }

  async getAllAnomalies(limit = 100): Promise<Anomaly[]> {
    return this.anomalyRepo.find({
      order: { timestamp: 'DESC' },
      take: limit,
    });
  }

  async getAnomaly(id: string): Promise<Anomaly | null> {
    return this.anomalyRepo.findOne({ where: { anomalyId: id } });
  }

  async getAnomaliesByService(service: string): Promise<Anomaly[]> {
    return this.anomalyRepo.find({
      where: { service },
      order: { timestamp: 'DESC' },
    });
  }
}
