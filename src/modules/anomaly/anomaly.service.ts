/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { store } from '../../common/store';
import {
  Anomaly,
  AnomalyType,
  AnomalySeverity,
  ParsedRequest,
} from '../../common/types';
import { v4 as uuidv4 } from 'uuid';
import { TelemetryService } from '../telemetry/telemetry.service';

interface DetectionRule {
  name: string;
  type: AnomalyType;
  check: (logs: ParsedRequest[]) => Anomaly | null;
}

@Injectable()
export class AnomalyService implements OnModuleInit {
  private readonly logger = new Logger(AnomalyService.name);
  private detectionInterval: NodeJS.Timeout;
  private eventEmitter: any;

  // Known baseline IPs (for demonstration)
  private readonly KNOWN_IPS = new Set([
    '10.0.0.0/8',
    '172.16.0.0/12',
    '192.168.0.0/16',
  ]);

  // Known service communications
  private readonly KNOWN_COMMUNICATIONS = new Set([
    'frontend->api-gateway',
    'api-gateway->auth-service',
    'api-gateway->payment-service',
    'api-gateway->inventory-service',
    'payment-service->billing-service',
    'inventory-service->notification-service',
  ]);

  // Known endpoints per service
  private readonly KNOWN_ENDPOINTS = new Map([
    [
      'auth-service',
      new Set(['/auth/login', '/auth/verify', '/auth/refresh', '/auth/logout']),
    ],
    [
      'payment-service',
      new Set([
        '/payments',
        '/payments/process',
        '/payments/refund',
        '/payments/history',
      ]),
    ],
    [
      'billing-service',
      new Set(['/billing/invoice', '/billing/statement', '/billing/calculate']),
    ],
    [
      'inventory-service',
      new Set(['/inventory/stock', '/inventory/update', '/inventory/check']),
    ],
    [
      'notification-service',
      new Set(['/notify/email', '/notify/sms', '/notify/push']),
    ],
  ]);

  constructor(
    private configService: ConfigService,
    private telemetryService: TelemetryService,
  ) {}

  onModuleInit() {
    this.startDetection();
  }

  setEventEmitter(emitter: any) {
    this.eventEmitter = emitter;
  }

  private startDetection() {
    const interval = this.configService.get('anomaly.detectionIntervalMs');

    this.detectionInterval = setInterval(() => {
      this.runDetection();
    }, interval);

    this.logger.log(`Anomaly detection started (interval: ${interval}ms)`);
  }

  private runDetection() {
    const recentLogs = store.getLogs(200); // Analyze last 200 logs

    const rules: DetectionRule[] = [
      {
        name: 'Unusual Source IP',
        type: 'UNUSUAL_SOURCE',
        check: (logs) => this.detectUnusualSource(logs),
      },
      {
        name: 'Unexpected Service Communication',
        type: 'UNEXPECTED_COMMUNICATION',
        check: (logs) => this.detectUnexpectedCommunication(logs),
      },
      {
        name: 'New Endpoint Access',
        type: 'NEW_ENDPOINT',
        check: (logs) => this.detectNewEndpoint(logs),
      },
      {
        name: 'High Error Rate',
        type: 'HIGH_ERROR_RATE',
        check: (logs) => this.detectHighErrorRate(logs),
      },
      {
        name: 'Traffic Spike',
        type: 'TRAFFIC_SPIKE',
        check: (logs) => this.detectTrafficSpike(logs),
      },
      {
        name: 'Suspicious Pattern',
        type: 'SUSPICIOUS_PATTERN',
        check: (logs) => this.detectSuspiciousPattern(logs),
      },
      {
        name: 'Latency Anomaly',
        type: 'LATENCY_ANOMALY',
        check: (logs) => this.detectLatencyAnomaly(logs),
      },
      {
        name: 'Unauthorized Access',
        type: 'UNAUTHORIZED_ACCESS',
        check: (logs) => this.detectUnauthorizedAccess(logs),
      },
    ];

    rules.forEach((rule) => {
      try {
        const anomaly = rule.check(recentLogs);
        if (anomaly) {
          store.addAnomaly(anomaly);
          this.logger.warn(
            `Anomaly detected: ${rule.name} - ${anomaly.details}`,
          );

          // Emit via websocket
          if (this.eventEmitter) {
            this.eventEmitter('anomaly.created', anomaly);
          }
        }
      } catch (error) {
        this.logger.error(`Error in detection rule ${rule.name}:`, error);
      }
    });
  }

  // Detection Rule 1: Unusual Source IP
  private detectUnusualSource(logs: ParsedRequest[]): Anomaly | null {
    const suspiciousIPs = ['192.0.2.1', '198.51.100.42', '203.0.113.99'];

    for (const log of logs.slice(-50)) {
      if (suspiciousIPs.includes(log.sourceIp)) {
        return this.createAnomaly({
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

  // Detection Rule 2: Unexpected Service Communication
  private detectUnexpectedCommunication(logs: ParsedRequest[]): Anomaly | null {
    for (const log of logs.slice(-50)) {
      if (log.destService) {
        const commKey = `${log.source}->${log.destService}`;
        if (!this.KNOWN_COMMUNICATIONS.has(commKey)) {
          return this.createAnomaly({
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

  // Detection Rule 3: New Endpoint Access
  private detectNewEndpoint(logs: ParsedRequest[]): Anomaly | null {
    for (const log of logs.slice(-50)) {
      const knownEndpoints = this.KNOWN_ENDPOINTS.get(log.service);
      if (knownEndpoints && !knownEndpoints.has(log.path)) {
        return this.createAnomaly({
          service: log.service,
          type: 'NEW_ENDPOINT',
          severity: 'low',
          details: `New endpoint accessed: ${log.method} ${log.path} on ${log.service}`,
          associatedLogs: [log.id],
        });
      }
    }
    return null;
  }

  // Detection Rule 4: High Error Rate
  private detectHighErrorRate(logs: ParsedRequest[]): Anomaly | null {
    const serviceGroups = this.groupByService(logs);

    for (const [service, serviceLogs] of Object.entries(serviceGroups)) {
      const errorCount = serviceLogs.filter((l) => l.status >= 400).length;
      const errorRate = (errorCount / serviceLogs.length) * 100;

      if (errorRate > 20 && serviceLogs.length > 10) {
        const errorLogIds = serviceLogs
          .filter((l) => l.status >= 400)
          .map((l) => l.id)
          .slice(0, 5);

        return this.createAnomaly({
          service,
          type: 'HIGH_ERROR_RATE',
          severity: 'high',
          details: `High error rate detected: ${errorRate.toFixed(1)}% (${errorCount}/${serviceLogs.length} requests)`,
          associatedLogs: errorLogIds,
        });
      }
    }
    return null;
  }

  // Detection Rule 5: Traffic Spike
  private detectTrafficSpike(logs: ParsedRequest[]): Anomaly | null {
    const serviceGroups = this.groupByService(logs);

    for (const [service, serviceLogs] of Object.entries(serviceGroups)) {
      // Simple spike detection: if recent count is 3x higher than baseline
      const recentCount = serviceLogs.filter(
        (l) => new Date(l.timestamp).getTime() > Date.now() - 10000,
      ).length;

      const baselineCount = serviceLogs.length / 20; // Average per 10s window

      if (recentCount > baselineCount * 3 && recentCount > 20) {
        return this.createAnomaly({
          service,
          type: 'TRAFFIC_SPIKE',
          severity: 'medium',
          details: `Traffic spike detected: ${recentCount} requests in last 10s (baseline: ${Math.round(baselineCount)})`,
          associatedLogs: serviceLogs.slice(-5).map((l) => l.id),
        });
      }
    }
    return null;
  }

  // Detection Rule 6: Suspicious Pattern
  private detectSuspiciousPattern(logs: ParsedRequest[]): Anomaly | null {
    // Detect rapid sequential requests from same IP
    const ipGroups = new Map<string, ParsedRequest[]>();

    logs.slice(-100).forEach((log) => {
      if (!ipGroups.has(log.sourceIp)) {
        ipGroups.set(log.sourceIp, []);
      }
      const arr = ipGroups.get(log.sourceIp);
      if (arr) {
        arr.push(log);
      }
    });

    for (const [ip, ipLogs] of ipGroups.entries()) {
      if (ipLogs.length > 30) {
        // More than 30 requests from same IP in short window
        return this.createAnomaly({
          service: ipLogs[0].service,
          type: 'SUSPICIOUS_PATTERN',
          severity: 'high',
          details: `Suspicious activity from IP ${ip}: ${ipLogs.length} requests in short window (possible DoS)`,
          associatedLogs: ipLogs.slice(0, 5).map((l) => l.id),
        });
      }
    }
    return null;
  }

  // Detection Rule 7: Latency Anomaly
  private detectLatencyAnomaly(logs: ParsedRequest[]): Anomaly | null {
    const serviceGroups = this.groupByService(logs);

    for (const [service, serviceLogs] of Object.entries(serviceGroups)) {
      if (serviceLogs.length < 10) continue;

      const avgLatency =
        serviceLogs.reduce((sum, l) => sum + l.latencyMs, 0) /
        serviceLogs.length;
      const recentLogs = serviceLogs.slice(-10);
      const recentAvgLatency =
        recentLogs.reduce((sum, l) => sum + l.latencyMs, 0) / recentLogs.length;

      // If recent latency is 3x higher than average
      if (recentAvgLatency > avgLatency * 3 && recentAvgLatency > 200) {
        return this.createAnomaly({
          service,
          type: 'LATENCY_ANOMALY',
          severity: 'medium',
          details: `Latency spike detected: ${Math.round(recentAvgLatency)}ms (baseline: ${Math.round(avgLatency)}ms)`,
          associatedLogs: recentLogs.map((l) => l.id),
        });
      }
    }
    return null;
  }

  // Detection Rule 8: Unauthorized Access
  private detectUnauthorizedAccess(logs: ParsedRequest[]): Anomaly | null {
    const unauthorizedLogs = logs
      .slice(-50)
      .filter((l) => l.status === 401 || l.status === 403);

    if (unauthorizedLogs.length > 5) {
      const service = unauthorizedLogs[0].service;
      return this.createAnomaly({
        service,
        type: 'UNAUTHORIZED_ACCESS',
        severity: 'high',
        details: `Multiple unauthorized access attempts detected: ${unauthorizedLogs.length} requests with 401/403 status`,
        associatedLogs: unauthorizedLogs.slice(0, 5).map((l) => l.id),
      });
    }
    return null;
  }

  private groupByService(
    logs: ParsedRequest[],
  ): Record<string, ParsedRequest[]> {
    return logs.reduce(
      (acc, log) => {
        if (!acc[log.service]) {
          acc[log.service] = [];
        }
        acc[log.service].push(log);
        return acc;
      },
      {} as Record<string, ParsedRequest[]>,
    );
  }

  private createAnomaly(params: {
    service: string;
    type: AnomalyType;
    severity: AnomalySeverity;
    details: string;
    associatedLogs: string[];
  }): Anomaly {
    return {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      ...params,
    };
  }

  getAllAnomalies(limit?: number): Anomaly[] {
    return store.getAllAnomalies(limit);
  }

  getAnomaly(id: string): Anomaly | undefined {
    return store.getAnomaly(id);
  }

  getAnomaliesByService(service: string): Anomaly[] {
    return store.getAnomaliesByService(service);
  }

  onModuleDestroy() {
    if (this.detectionInterval) {
      clearInterval(this.detectionInterval);
    }
  }
}
