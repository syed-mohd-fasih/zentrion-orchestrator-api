import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as http from 'http';
import { TelemetryLog } from '../database/entities/telemetry-log.entity';

export interface AiDetectionResult {
  service: string;
  anomalyType: string;
  confidence: number;
  details: string;
  features: Record<string, number>;
}

interface DetectResponse {
  results: AiDetectionResult[];
}

@Injectable()
export class AiDetectionService {
  private readonly logger = new Logger(AiDetectionService.name);
  private readonly host: string;
  private readonly port: number;

  constructor(private configService: ConfigService) {
    this.host = this.configService.get<string>('ai.mlServiceHost', 'host.minikube.internal');
    this.port = this.configService.get<number>('ai.mlServicePort', 8000);
  }

  async detect(windowLogs: TelemetryLog[]): Promise<AiDetectionResult[] | null> {
    if (windowLogs.length === 0) return null;
    const features = this.extractFeatures(windowLogs);
    const body = JSON.stringify({ window_logs: features });
    try {
      const raw = await this.httpPost('/detect', body, 30_000);
      const response = JSON.parse(raw) as DetectResponse;
      return response.results ?? null;
    } catch (err) {
      this.logger.warn(`ML service detect failed: ${(err as Error).message}`);
      return null;
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.httpGet('/health', 2_000);
      return true;
    } catch {
      return false;
    }
  }

  private extractFeatures(logs: TelemetryLog[]): Record<string, number>[] {
    // Group by (service, 5-minute window bucket) and compute 16 features per group.
    const buckets = new Map<string, TelemetryLog[]>();
    for (const log of logs) {
      const bucket = Math.floor(log.timestamp.getTime() / (5 * 60 * 1000));
      const key = `${log.service}|${bucket}`;
      const group = buckets.get(key) ?? [];
      group.push(log);
      buckets.set(key, group);
    }

    const SUSPICIOUS_IPS = new Set(['192.0.2.1', '198.51.100.42', '203.0.113.99']);
    const SENSITIVE_PATHS = ['/admin', '/.env', '/config', '/debug', '/actuator'];

    const results: Record<string, number>[] = [];
    for (const [key, group] of buckets.entries()) {
      const [service] = key.split('|');
      const n = group.length;
      const latencies = group.map((l) => l.latencyMs).sort((a, b) => a - b);
      const errorLogs = group.filter((l) => l.status >= 400);
      const logs4xx = group.filter((l) => l.status >= 400 && l.status < 500);
      const logs5xx = group.filter((l) => l.status >= 500);
      const windowSecs = 5 * 60;
      const meanLatency = n > 0 ? latencies.reduce((a, b) => a + b, 0) / n : 0;
      const p95idx = Math.floor(n * 0.95);
      const p99idx = Math.floor(n * 0.99);

      results.push({
        service_id: 0, // placeholder — Python side uses label encoding
        request_count: n,
        error_rate: n > 0 ? errorLogs.length / n : 0,
        p95_latency_ms: latencies[p95idx] ?? latencies[n - 1] ?? 0,
        mean_latency_ms: meanLatency,
        unique_source_ips: new Set(group.map((l) => l.sourceIp)).size,
        unique_paths: new Set(group.map((l) => l.path)).size,
        req_per_second: n / windowSecs,
        status_4xx_rate: n > 0 ? logs4xx.length / n : 0,
        status_5xx_rate: n > 0 ? logs5xx.length / n : 0,
        max_latency_ms: latencies[n - 1] ?? 0,
        suspicious_ip_count: group.filter((l) => SUSPICIOUS_IPS.has(l.sourceIp)).length,
        sensitive_path_count: group.filter((l) =>
          SENSITIVE_PATHS.some((p) => l.path.includes(p)),
        ).length,
        mean_request_size: n > 0
          ? group.reduce((s, l) => s + (l.requestSize ?? 0), 0) / n
          : 0,
        mean_response_size: n > 0
          ? group.reduce((s, l) => s + (l.responseSize ?? 0), 0) / n
          : 0,
        unique_dest_services: new Set(group.map((l) => l.destService).filter(Boolean)).size,
        p99_latency_ms: latencies[p99idx] ?? latencies[n - 1] ?? 0,
        _service: service as unknown as number, // passed through for context
      });
    }
    return results;
  }

  private httpPost(path: string, body: string, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: this.host,
          port: this.port,
          path,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
          res.on('error', reject);
        },
      );
      req.setTimeout(timeoutMs, () => req.destroy(new Error('Request timed out')));
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  private httpGet(path: string, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        { host: this.host, port: this.port, path, method: 'GET' },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
          res.on('error', reject);
        },
      );
      req.setTimeout(timeoutMs, () => req.destroy(new Error('Request timed out')));
      req.on('error', reject);
      req.end();
    });
  }
}
