/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { store } from '../../common/store';
import { ParsedRequest, ServiceInfo } from '../../common/types';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class TelemetryService implements OnModuleInit {
  private readonly logger = new Logger(TelemetryService.name);
  private generatorInterval: NodeJS.Timeout;
  private eventEmitter: any; // Will be set by gateway

  private readonly HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
  private readonly STATUS_CODES = [
    200, 201, 204, 400, 401, 403, 404, 500, 502, 503,
  ];

  // Service dependency graph
  private readonly SERVICE_GRAPH = {
    frontend: ['api-gateway'],
    'api-gateway': ['auth-service', 'payment-service', 'inventory-service'],
    'auth-service': [],
    'payment-service': ['billing-service'],
    'billing-service': [],
    'inventory-service': ['notification-service'],
    'notification-service': [],
  };

  // Endpoint patterns per service
  private readonly ENDPOINTS = {
    'api-gateway': ['/api/health', '/api/status', '/api/metrics'],
    'auth-service': [
      '/auth/login',
      '/auth/verify',
      '/auth/refresh',
      '/auth/logout',
    ],
    'payment-service': [
      '/payments',
      '/payments/process',
      '/payments/refund',
      '/payments/history',
    ],
    'billing-service': [
      '/billing/invoice',
      '/billing/statement',
      '/billing/calculate',
    ],
    'inventory-service': [
      '/inventory/stock',
      '/inventory/update',
      '/inventory/check',
    ],
    'notification-service': ['/notify/email', '/notify/sms', '/notify/push'],
  };

  private readonly SUSPICIOUS_IPS = [
    '192.0.2.1',
    '198.51.100.42',
    '203.0.113.99',
  ];

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    this.startGenerator();
  }

  setEventEmitter(emitter: any) {
    this.eventEmitter = emitter;
  }

  private startGenerator() {
    const interval = this.configService.get('telemetry.generationIntervalMs');
    const burstSize = this.configService.get('telemetry.burstSize');

    this.generatorInterval = setInterval(() => {
      // Generate burst of logs
      for (let i = 0; i < burstSize; i++) {
        const log = this.generateSyntheticLog();
        store.addLog(log);

        // Emit via websocket
        if (this.eventEmitter) {
          this.eventEmitter('telemetry.log', log);
        }
      }

      // Update service metrics
      this.updateServiceMetrics();
    }, interval);

    this.logger.log(
      `Telemetry generator started (interval: ${interval}ms, burst: ${burstSize})`,
    );
  }

  private generateSyntheticLog(): ParsedRequest {
    const services = Object.keys(this.SERVICE_GRAPH);
    const sourceService = services[Math.floor(Math.random() * services.length)];
    const possibleDests = this.SERVICE_GRAPH[sourceService];
    const destService =
      possibleDests.length > 0
        ? possibleDests[Math.floor(Math.random() * possibleDests.length)]
        : null;

    const method =
      this.HTTP_METHODS[Math.floor(Math.random() * this.HTTP_METHODS.length)];
    const endpoints = this.ENDPOINTS[destService] || ['/api/default'];
    const path = endpoints[Math.floor(Math.random() * endpoints.length)];

    // Weighted status codes (90% success, 10% errors)
    const statusWeights = [
      200, 200, 200, 200, 200, 200, 200, 200, 201, 400, 404, 500,
    ];
    const status =
      statusWeights[Math.floor(Math.random() * statusWeights.length)];

    // Occasionally use suspicious IPs (5% chance)
    const useSuspiciousIP = Math.random() < 0.05;
    const sourceIp = useSuspiciousIP
      ? this.SUSPICIOUS_IPS[
          Math.floor(Math.random() * this.SUSPICIOUS_IPS.length)
        ]
      : `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;

    const log: ParsedRequest = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      source: sourceService,
      sourceIp,
      method,
      path,
      status,
      latencyMs: Math.floor(Math.random() * 500) + 10,
      service: destService || sourceService,
      destService,
      userAgent: 'Istio/Envoy',
      requestSize: Math.floor(Math.random() * 10000),
      responseSize: Math.floor(Math.random() * 50000),
    };

    return log;
  }

  private updateServiceMetrics() {
    const services = store.getAllServices();
    const recentLogs = store.getLogs(100);

    services.forEach((service) => {
      const serviceLogs = recentLogs.filter((l) => l.service === service.name);

      if (serviceLogs.length > 0) {
        const errorCount = serviceLogs.filter((l) => l.status >= 400).length;
        const totalLatency = serviceLogs.reduce(
          (sum, l) => sum + l.latencyMs,
          0,
        );

        const updates: Partial<ServiceInfo> = {
          requestsPerSecond: parseFloat((serviceLogs.length / 10).toFixed(2)),
          errorRate: parseFloat(
            ((errorCount / serviceLogs.length) * 100).toFixed(2),
          ),
          avgLatency: Math.round(totalLatency / serviceLogs.length),
          lastSeen: new Date().toISOString(),
        };

        store.updateServiceMetrics(service.name, updates);

        // Emit service update
        if (this.eventEmitter) {
          this.eventEmitter('service.update', {
            name: service.name,
            ...updates,
          });
        }
      }
    });
  }

  getLogs(limit = 100, service?: string): ParsedRequest[] {
    return store.getLogs(limit, service);
  }

  getServices(): ServiceInfo[] {
    return store.getAllServices();
  }

  getService(name: string): ServiceInfo | undefined {
    return store.getService(name);
  }

  onModuleDestroy() {
    if (this.generatorInterval) {
      clearInterval(this.generatorInterval);
    }
  }
}
