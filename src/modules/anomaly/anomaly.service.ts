import { Injectable, OnModuleInit, OnModuleDestroy, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Anomaly } from '../database/entities/anomaly.entity';
import { TelemetryLog } from '../database/entities/telemetry-log.entity';
import { AnomalyType, AnomalySeverity } from '../../common/types';
import { v4 as uuidv4 } from 'uuid';
import { AiDetectionService } from './ai-detection.service';
import { SettingsService } from '../settings/settings.service';

/**
 * Rule-based anomaly detection engine.
 *
 * Runs on an interval (`anomaly.detectionIntervalMs`, default 5s), pulls
 * the most recent telemetry window from Postgres, and runs eight detectors
 * over it:
 *   1. UNUSUAL_SOURCE          — traffic from a known-bad IP.
 *   2. UNEXPECTED_COMMUNICATION — service→service edges outside the whitelist.
 *   3. NEW_ENDPOINT            — hits on sensitive paths (`/admin`, `/.env`, ...).
 *   4. HIGH_ERROR_RATE         — >20% 4xx/5xx over a window.
 *   5. TRAFFIC_SPIKE           — recent RPS ≫ windowed baseline.
 *   6. SUSPICIOUS_PATTERN      — single-IP burst (>30 requests).
 *   7. LATENCY_ANOMALY         — recent latency ≫ windowed mean.
 *   8. UNAUTHORIZED_ACCESS     — >5 401/403 responses.
 *
 * Each detector returns at most one `Anomaly` per tick to avoid flooding
 * the dashboard. Future work replaces these rules with ML models (see
 * "Future Work" in `CLAUDE.md`).
 */
@Injectable()
export class AnomalyService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnomalyService.name);
  private detectionInterval: NodeJS.Timeout;
  /** Optional callback registered by `TelemetryGateway` for real-time push. */
  private eventEmitter: ((event: string, data: any) => void) | null = null;

  /** IPs that immediately trigger `UNUSUAL_SOURCE` on any request. */
  private readonly SUSPICIOUS_IPS = new Set([
    '192.0.2.1',
    '198.51.100.42',
    '203.0.113.99',
  ]);

  /** Allow-list of known service-to-service edges. */
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
    @Optional() private aiDetectionService: AiDetectionService,
    @Optional() private settingsService: SettingsService,
  ) {}

  /** Start the detection loop when the module is ready. */
  onModuleInit() {
    this.startDetection();
  }

  /** Stop the interval on shutdown so tests/pods exit cleanly. */
  onModuleDestroy() {
    if (this.detectionInterval) {
      clearInterval(this.detectionInterval);
    }
  }

  /**
   * Wire in the WebSocket emitter callback (called by the gateway).
   * When set, each newly saved anomaly is also broadcast live.
   */
  setEventEmitter(emitter: (event: string, data: any) => void) {
    this.eventEmitter = emitter;
  }

  /**
   * Kick off the periodic `runDetection` loop.
   * Interval is controlled via `anomaly.detectionIntervalMs` config.
   */
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
    const mode = this.settingsService?.getDetectionMode() ?? 'rules';
    if (mode === 'ai' && this.aiDetectionService) {
      await this.runAiDetection();
    } else {
      await this.runRuleDetection();
    }
  }

  private async runAiDetection() {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const recentLogs = await this.logRepo.find({
      where: { timestamp: MoreThan(fiveMinutesAgo) },
      order: { timestamp: 'DESC' },
      take: 200,
    });
    if (recentLogs.length === 0) return;

    const results = await this.aiDetectionService.detect(recentLogs);
    if (!results) return;

    const threshold = this.settingsService?.getAiConfidenceThreshold() ?? 0.7;

    for (const result of results) {
      if (result.confidence < threshold) continue;
      const pct = Math.round(result.confidence * 100);
      const anomaly = this.buildAnomaly({
        service: result.service,
        type: result.anomalyType as AnomalyType,
        severity: result.confidence >= 0.9 ? 'high' : result.confidence >= 0.7 ? 'medium' : 'low',
        details: `[AI ${pct}%] ${result.details}`,
        associatedLogs: recentLogs
          .filter((l) => l.service === result.service)
          .slice(0, 5)
          .map((l) => l.id),
      });
      await this.anomalyRepo.save(anomaly);
      this.logger.warn(`AI anomaly detected: ${anomaly.type} on ${anomaly.service} (${pct}%)`);
      if (this.eventEmitter) {
        this.eventEmitter('anomaly.created', anomaly);
      }
    }
  }

  private async runRuleDetection() {
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
          anomaly.details = `[RULE] ${anomaly.details}`;
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

  /**
   * Detector #1: flag requests originating from IPs on the suspicious list.
   * Only scans the 50 most recent logs — enough to keep the dashboard
   * responsive without spending detection time re-walking history.
   */
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

  /**
   * Detector #2: flag service→service edges not in `KNOWN_COMMUNICATIONS`.
   * Captures lateral movement where an attacker compromises one service
   * and pivots to another it shouldn't normally talk to.
   */
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

  /**
   * Detector #3: flag requests to sensitive paths (`/admin`, `/.env`,
   * `/config`). A 404 is considered benign (scan bouncing off a missing
   * handler) — anything else is suspicious.
   */
  private detectNewEndpoint(logs: TelemetryLog[]): Anomaly | null {
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

  /**
   * Detector #4: per-service error rate > 20% over the window. Requires
   * at least 10 samples so freshly-deployed services don't trip the rule
   * on a handful of start-up errors.
   */
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

  /**
   * Detector #5: traffic spike — recent 10s RPS > 3× the windowed baseline
   * AND > 20 requests absolute (prevents low-volume services from tripping
   * when a handful of requests arrive together).
   */
  private detectTrafficSpike(logs: TelemetryLog[]): Anomaly | null {
    const serviceGroups = this.groupByService(logs);

    for (const [service, serviceLogs] of Object.entries(serviceGroups)) {
      const recentCount = serviceLogs.filter(
        (l) => l.timestamp.getTime() > Date.now() - 10_000,
      ).length;
      // Rough baseline: window-total / 20 (the window is ~200s worth of logs).
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

  /**
   * Detector #6: single-IP burst. Any source IP emitting >30 requests in
   * the window (≈5 min) is flagged — catches scanners and brute-force.
   */
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

  /**
   * Detector #7: latency regression. Compares the most recent 10 requests
   * against the service's windowed mean; requires >3× increase and an
   * absolute threshold of 200 ms to suppress noise on fast services.
   */
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

  /**
   * Detector #8: >5 401/403 responses in the window. Classic signal for
   * credential-stuffing or token-scanning attacks.
   */
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

  /** Bucket logs by `service` name. Shared helper across multiple detectors. */
  private groupByService(logs: TelemetryLog[]): Record<string, TelemetryLog[]> {
    return logs.reduce<Record<string, TelemetryLog[]>>((acc, log) => {
      acc[log.service] = acc[log.service] ?? [];
      acc[log.service].push(log);
      return acc;
    }, {});
  }

  /**
   * Construct a fresh `Anomaly` entity with a new UUID and current time.
   * Centralised so all detectors produce uniformly-shaped rows.
   */
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

  /** Return the `limit` most recent anomalies across all services. */
  async getAllAnomalies(limit = 100): Promise<Anomaly[]> {
    return this.anomalyRepo.find({
      order: { timestamp: 'DESC' },
      take: limit,
    });
  }

  /** Fetch an anomaly by its public `anomalyId` UUID (not the DB primary key). */
  async getAnomaly(id: string): Promise<Anomaly | null> {
    return this.anomalyRepo.findOne({ where: { anomalyId: id } });
  }

  /** Return every anomaly for a given service, newest first. */
  async getAnomaliesByService(service: string): Promise<Anomaly[]> {
    return this.anomalyRepo.find({
      where: { service },
      order: { timestamp: 'DESC' },
    });
  }
}
