import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { K8sService } from '../k8s/k8s.service';
import * as k8s from '@kubernetes/client-node';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PassThrough } from 'stream';

/**
 * Istio telemetry watcher.
 *
 * Produces Zentrion's telemetry stream by tailing `istio-proxy` container
 * logs from every pod in the monitored namespaces. Each parsed access log
 * line is emitted on the internal event bus as `telemetry.log`, where the
 * telemetry service persists it to Postgres and the anomaly engine picks
 * it up.
 *
 * Lifecycle:
 *  - `onModuleInit`    — starts watchers for each monitored namespace.
 *  - `onModuleDestroy` — aborts every pod watcher and closes every log stream.
 *
 * The service also watches for newly created sidecar pods so freshly-
 * deployed workloads are picked up without a pod restart.
 */
@Injectable()
export class IstioService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IstioService.name);
  /** Per-namespace K8s `Watch` handles (used so we can abort on shutdown). */
  private watchers: Map<string, any> = new Map();
  /** Active log streams keyed by `namespace/podName`. */
  private logStreams: Map<string, any> = new Map();

  constructor(
    private k8sService: K8sService,
    private configService: ConfigService,
    private eventEmitter: EventEmitter2,
  ) {}

  /**
   * Start watching immediately on module init unless telemetry is disabled.
   */
  async onModuleInit() {
    const enabled = this.configService.get('ISTIO_TELEMETRY_ENABLED', 'true') === 'true';
    if (enabled) {
      await this.startWatchingTelemetry();
    }
  }

  /** Graceful shutdown — stop every open watcher/stream. */
  onModuleDestroy() {
    this.stopWatching();
  }

  /**
   * Bootstrap all watchers: resolve the target namespaces and spin up a
   * watch+log-tail per namespace.
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
   * Resolve which namespaces to monitor.
   *
   * - `K8S_WATCH_NAMESPACES=all` → every namespace except `kube-*` and
   *   `istio-system` (we don't want control-plane noise in telemetry).
   * - otherwise a comma-separated list of explicit namespaces.
   */
  private async getMonitoredNamespaces(): Promise<string[]> {
    const watchNamespaces = this.configService.get('K8S_WATCH_NAMESPACES', 'all');

    if (watchNamespaces === 'all') {
      const allNamespaces = await this.k8sService.getNamespaces();
      return allNamespaces.filter(
        (ns) => !['kube-system', 'kube-public', 'kube-node-lease', 'istio-system'].includes(ns),
      );
    } else {
      return watchNamespaces.split(',').map((ns) => ns.trim());
    }
  }

  /**
   * Set up log tailing for every running sidecar pod in a namespace, then
   * install a pod watcher so future pods are picked up automatically.
   *
   * @param namespace Namespace to monitor.
   */
  private async watchNamespace(namespace: string) {
    try {
      const k8sApi = this.k8sService.getK8sApi();
      const kc = this.k8sService.getKubeConfig();

      const podsResponse = await k8sApi.listNamespacedPod(namespace);

      // Only pods that have an `istio-proxy` sidecar and are currently running.
      // istio-proxy may be a native sidecar (initContainer with restartPolicy:Always, Istio 1.22+)
      const pods = podsResponse.body.items.filter((pod) => {
        const hasProxy = pod.spec?.containers?.some((c) => c.name === 'istio-proxy')
          || pod.spec?.initContainers?.some((c) => c.name === 'istio-proxy');
        const isRunning = pod.status?.phase === 'Running';
        return hasProxy && isRunning;
      });

      this.logger.log(`Found ${pods.length} pods with Istio sidecar in namespace ${namespace}`);

      for (const pod of pods) {
        const podName = pod.metadata?.name;
        if (!podName) continue;

        await this.watchPodLogs(namespace, podName, kc);
      }

      this.setupPodWatcher(namespace);

    } catch (error) {
      this.logger.error(`Failed to watch namespace ${namespace}: ${error.message}`);
    }
  }

  /**
   * Tail the `istio-proxy` container logs of a single pod and push each
   * non-empty line through `processEnvoyLog`.
   *
   * Uses a `PassThrough` so chunk boundaries don't split log lines in half;
   * any trailing partial line is held in `buffer` until the next chunk.
   *
   * @param namespace Pod namespace.
   * @param podName   Pod name.
   * @param kc        Active kubeconfig (passed in rather than re-fetched).
   */
  private async watchPodLogs(namespace: string, podName: string, kc: k8s.KubeConfig) {
    const streamKey = `${namespace}/${podName}`;

    // Guard against double-watching when `setupPodWatcher` fires MODIFIED
    // events for pods we're already tailing.
    if (this.logStreams.has(streamKey)) return;

    try {
      const logApi = new k8s.Log(kc);

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

      let buffer = '';

      passThrough.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        // Last element is the (possibly incomplete) trailing fragment — hold it.
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
   * Parse an Envoy access log line (JSON first, then text fallback) and
   * publish a `telemetry.log` event carrying the parsed fields plus the
   * emitting pod identity.
   */
  private processEnvoyLog(line: string, namespace: string, podName: string) {
    try {
      let logData;

      try {
        logData = JSON.parse(line);
      } catch {
        logData = this.parseEnvoyTextLog(line);
      }

      if (!logData) return;

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
   * Parse the default Envoy text access-log format.
   *
   * Example line:
   *   [2025-01-15T10:30:45.123Z] "GET /productpage HTTP/1.1" 200 - "-" ...
   *
   * Only a handful of fields are extracted — enough to drive anomaly
   * detection. Extend the regex if more fields are needed.
   *
   * @param line Raw log line.
   * @returns An object with `timestamp`, `method`, `path`, `protocol`,
   *          and `status`, or `null` if the line doesn't match.
   */
  private parseEnvoyTextLog(line: string): any | null {
    try {
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
   * Install a `Watch` on the pod list of a namespace so new sidecar pods
   * (from rollouts, scale-ups) begin tailing automatically.
   *
   * @param namespace Namespace to watch.
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
            const hasProxy = pod.spec?.containers?.some((c) => c.name === 'istio-proxy')
              || pod.spec?.initContainers?.some((c) => c.name === 'istio-proxy');
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
   * Close every open log stream and abort every pod watcher.
   * Called from `onModuleDestroy` to keep shutdown clean.
   */
  private stopWatching() {
    this.logger.log('Stopping all telemetry watchers...');

    for (const [key, stream] of this.logStreams.entries()) {
      try {
        stream.destroy();
        this.logger.debug(`Closed log stream: ${key}`);
      } catch (error) {
        this.logger.error(`Failed to close stream ${key}: ${error.message}`);
      }
    }
    this.logStreams.clear();

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
