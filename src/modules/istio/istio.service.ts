import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { K8sService } from '../k8s/k8s.service';
import * as k8s from '@kubernetes/client-node';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PassThrough } from 'stream';

/**
 * Istio Telemetry Service
 * Watches Envoy access logs from Istio sidecars
 */
@Injectable()
export class IstioService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IstioService.name);
  private watchers: Map<string, any> = new Map();
  private logStreams: Map<string, any> = new Map();

  constructor(
    private k8sService: K8sService,
    private configService: ConfigService,
    private eventEmitter: EventEmitter2,
  ) {}

  async onModuleInit() {
    const enabled = this.configService.get('ISTIO_TELEMETRY_ENABLED', 'true') === 'true';
    if (enabled) {
      await this.startWatchingTelemetry();
    }
  }

  onModuleDestroy() {
    this.stopWatching();
  }

  /**
   * Start watching Envoy access logs across all namespaces
   */
  private async startWatchingTelemetry() {
    try {
      const namespaces = await this.getMonitoredNamespaces();
      
      this.logger.log(`Starting Istio telemetry watch for namespaces: ${namespaces.join(', ')}`);

      for (const namespace of namespaces) {
        await this.watchNamespace(namespace);
      }

      this.logger.log('✅ Istio telemetry watchers started');
    } catch (error) {
      this.logger.error(`Failed to start telemetry watching: ${error.message}`);
    }
  }

  /**
   * Get list of namespaces to monitor
   */
  private async getMonitoredNamespaces(): Promise<string[]> {
    const watchNamespaces = this.configService.get('K8S_WATCH_NAMESPACES', 'all');

    if (watchNamespaces === 'all') {
      // Watch all namespaces except kube-system and istio-system
      const allNamespaces = await this.k8sService.getNamespaces();
      return allNamespaces.filter(
        (ns) => !['kube-system', 'kube-public', 'kube-node-lease', 'istio-system'].includes(ns),
      );
    } else {
      return watchNamespaces.split(',').map((ns) => ns.trim());
    }
  }

  /**
   * Watch a specific namespace for pod logs
   */
  private async watchNamespace(namespace: string) {
    try {
      const k8sApi = this.k8sService.getK8sApi();
      const kc = this.k8sService.getKubeConfig();

      // Get all pods in this namespace and filter for Istio sidecar
      const podsResponse = await k8sApi.listNamespacedPod(namespace);

      const pods = podsResponse.body.items.filter((pod) => {
        const hasProxy = pod.spec?.containers?.some((c) => c.name === 'istio-proxy');
        const isRunning = pod.status?.phase === 'Running';
        return hasProxy && isRunning;
      });

      this.logger.log(`Found ${pods.length} pods with Istio sidecar in namespace ${namespace}`);

      // Watch each pod's istio-proxy container logs
      for (const pod of pods) {
        const podName = pod.metadata?.name;
        if (!podName) continue;

        await this.watchPodLogs(namespace, podName, kc);
      }

      // Set up watcher for new pods in this namespace
      this.setupPodWatcher(namespace);

    } catch (error) {
      this.logger.error(`Failed to watch namespace ${namespace}: ${error.message}`);
    }
  }

  /**
   * Watch logs from istio-proxy container in a pod
   */
  private async watchPodLogs(namespace: string, podName: string, kc: k8s.KubeConfig) {
    const streamKey = `${namespace}/${podName}`;

    // Don't re-watch if already streaming
    if (this.logStreams.has(streamKey)) return;

    try {
      const logApi = new k8s.Log(kc);

      // Use a PassThrough stream to capture log output
      const passThrough = new PassThrough();

      await logApi.log(
        namespace,
        podName,
        'istio-proxy',
        passThrough,
        (err) => {
          if (err) {
            this.logger.error(`Log stream error for ${streamKey}: ${err.message || err}`);
            this.logStreams.delete(streamKey);
          }
        },
        { follow: true, tailLines: 0, pretty: false, timestamps: false },
      );

      // Parse and emit log lines from the PassThrough stream
      let buffer = '';

      passThrough.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim()) {
            this.processEnvoyLog(line, namespace, podName);
          }
        }
      });

      passThrough.on('error', (err) => {
        this.logger.error(`Stream error for ${streamKey}: ${err.message}`);
        this.logStreams.delete(streamKey);
      });

      passThrough.on('close', () => {
        this.logger.debug(`Stream closed for ${streamKey}`);
        this.logStreams.delete(streamKey);
      });

      this.logStreams.set(streamKey, passThrough);
      this.logger.debug(`Started watching logs for ${streamKey}`);

    } catch (error) {
      this.logger.error(`Failed to watch logs for ${streamKey}: ${error?.message || error}`);
    }
  }

  /**
   * Parse and emit Envoy access log
   */
  private processEnvoyLog(line: string, namespace: string, podName: string) {
    try {
      // Envoy logs can be in JSON format (if configured)
      // Try to parse as JSON first
      let logData;
      
      try {
        logData = JSON.parse(line);
      } catch {
        // If not JSON, try to parse text format
        logData = this.parseEnvoyTextLog(line);
      }

      if (!logData) return;

      // Emit telemetry event
      this.eventEmitter.emit('telemetry.log', {
        ...logData,
        namespace,
        pod: podName,
      });

    } catch (error) {
      this.logger.debug(`Failed to process log line: ${error.message}`);
    }
  }

  /**
   * Parse Envoy text format log
   * Example: [2025-01-15T10:30:45.123Z] "GET /productpage HTTP/1.1" 200 - "-" "-" 0 4183 127 125 "-" "curl/7.64.1" "abc-123" "productpage:9080" "10.244.0.15:9080"
   */
  private parseEnvoyTextLog(line: string): any | null {
    try {
      // Simple regex to extract key fields
      const match = line.match(
        /\[([^\]]+)\] "(\w+) ([^ ]+) ([^"]+)" (\d+) /
      );

      if (!match) return null;

      const [, timestamp, method, path, protocol, status] = match;

      return {
        timestamp: new Date(timestamp).toISOString(),
        method,
        path,
        protocol,
        status: parseInt(status, 10),
      };
    } catch {
      return null;
    }
  }

  /**
   * Setup watcher for new pods in namespace
   */
  private setupPodWatcher(namespace: string) {
    try {
      const kc = this.k8sService.getKubeConfig();
      const watch = new k8s.Watch(kc);
      
      const path = `/api/v1/namespaces/${namespace}/pods`;
      
      const watcher = watch.watch(
        path,
        {},
        (type, pod: k8s.V1Pod) => {
          if (type === 'ADDED' || type === 'MODIFIED') {
            const hasProxy = pod.spec?.containers?.some((c) => c.name === 'istio-proxy');
            if (hasProxy && pod.status?.phase === 'Running') {
              const podName = pod.metadata?.name;
              if (podName && !this.logStreams.has(`${namespace}/${podName}`)) {
                this.logger.log(`New pod detected: ${namespace}/${podName}`);
                this.watchPodLogs(namespace, podName, kc);
              }
            }
          }
        },
        (err) => {
          if (err) {
            this.logger.error(`Pod watcher error for ${namespace}: ${err.message}`);
          }
        },
      );

      this.watchers.set(namespace, watcher);
      this.logger.debug(`Pod watcher started for namespace: ${namespace}`);

    } catch (error) {
      this.logger.error(`Failed to setup pod watcher for ${namespace}: ${error.message}`);
    }
  }

  /**
   * Stop all watchers and streams
   */
  private stopWatching() {
    this.logger.log('Stopping all telemetry watchers...');

    // Close all log streams
    for (const [key, stream] of this.logStreams.entries()) {
      try {
        stream.destroy();
        this.logger.debug(`Closed log stream: ${key}`);
      } catch (error) {
        this.logger.error(`Failed to close stream ${key}: ${error.message}`);
      }
    }
    this.logStreams.clear();

    // Abort all watchers
    for (const [namespace, watcher] of this.watchers.entries()) {
      try {
        watcher.abort();
        this.logger.debug(`Aborted watcher for namespace: ${namespace}`);
      } catch (error) {
        this.logger.error(`Failed to abort watcher for ${namespace}: ${error.message}`);
      }
    }
    this.watchers.clear();

    this.logger.log('✅ All telemetry watchers stopped');
  }
}
