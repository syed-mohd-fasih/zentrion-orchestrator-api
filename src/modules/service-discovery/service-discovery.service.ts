import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { K8sService } from '../k8s/k8s.service';
import { CrdService } from '../crd/crd.service';
import { Service as ServiceEntity } from '../database/entities/service.entity';
import * as k8s from '@kubernetes/client-node';

/**
 * Service-discovery watcher.
 *
 * Streams `Deployment` events from the K8s API and mirrors every workload
 * it sees into two places:
 *  - the relational `services` table (for dashboard queries); and
 *  - a `SecurityProfile` CRD (for K8s-native inspection + future policy
 *    learning baselines).
 *
 * Dependencies between services are *not* inferred here — those are learned
 * later from telemetry via `updateServiceDependencies`.
 */
@Injectable()
export class ServiceDiscoveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ServiceDiscoveryService.name);
  /** Active per-namespace watcher handles (for clean shutdown). */
  private watchers: Map<string, any> = new Map();

  constructor(
    @InjectRepository(ServiceEntity)
    private serviceRepository: Repository<ServiceEntity>,
    private k8sService: K8sService,
    private crdService: CrdService,
    private configService: ConfigService,
  ) {}

  /** Start watching deployments as soon as the module is ready. */
  async onModuleInit() {
    await this.startWatching();
  }

  /** Stop every watcher on shutdown. */
  onModuleDestroy() {
    this.stopWatching();
  }

  /**
   * Resolve the target namespaces and install a deployment watcher on each.
   */
  private async startWatching() {
    try {
      const namespaces = await this.getMonitoredNamespaces();

      this.logger.log(`Starting service discovery for namespaces: ${namespaces.join(', ')}`);

      for (const namespace of namespaces) {
        await this.watchDeploymentsInNamespace(namespace);
      }

      this.logger.log(`✅ Watching deployments in ${namespaces.length} namespaces`);
    } catch (error) {
      this.logger.error(`Failed to start service discovery: ${error.message}`);
    }
  }

  /**
   * Install a `Watch` on `apps/v1 Deployments` in a single namespace.
   *
   * ADDED/MODIFIED events upsert the service; DELETED events are logged
   * but intentionally do NOT delete the DB row — we keep historical
   * records so the dashboard can show deprovisioned services.
   *
   * Error handler auto-retries after 5s: watch streams routinely close on
   * long-running API server rotations and need to be re-established.
   *
   * @param namespace Namespace to watch.
   */
  private async watchDeploymentsInNamespace(namespace: string) {
    try {
      const kc = this.k8sService.getKubeConfig();
      const watch = new k8s.Watch(kc);

      const path = `/apis/apps/v1/namespaces/${namespace}/deployments`;

      const watcher = await watch.watch(
        path,
        {},
        async (type, deployment: k8s.V1Deployment) => {
          if (type === 'ADDED' || type === 'MODIFIED') {
            await this.handleDeployment(deployment);
          } else if (type === 'DELETED') {
            await this.handleDeploymentDeleted(deployment);
          }
        },
        (err) => {
          if (err) {
            this.logger.error(`Deployment watcher error for ${namespace}: ${err.message}`);
            // Re-establish after backoff. Watch streams die routinely.
            setTimeout(() => this.watchDeploymentsInNamespace(namespace), 5000);
          }
        },
      );

      this.watchers.set(namespace, watcher);
      this.logger.log(`Started watching deployments in namespace: ${namespace}`);

    } catch (error) {
      this.logger.error(`Failed to watch deployments in ${namespace}: ${error.message}`);
    }
  }

  /**
   * Handle an ADDED/MODIFIED deployment event.
   *
   * If the row already exists it's touched (`lastSeen` bump, label refresh);
   * otherwise it's inserted and a matching `SecurityProfile` CRD is created.
   * CRD creation failure is logged but does not fail the whole flow —
   * profiles can always be created later by re-running discovery.
   */
  private async handleDeployment(deployment: k8s.V1Deployment) {
    const name = deployment.metadata?.name;
    const namespace = deployment.metadata?.namespace;
    const labels = deployment.metadata?.labels || {};

    if (!name || !namespace) return;

    try {
      let service = await this.serviceRepository.findOne({ where: { name } });

      if (service) {
        service.lastSeen = new Date();
        service.labels = labels;
        await this.serviceRepository.save(service);

        this.logger.debug(`Updated service: ${name} in ${namespace}`);
      } else {
        service = new ServiceEntity();
        service.name = name;
        service.namespace = namespace;
        service.labels = labels;
        service.dependencies = []; // Populated later from telemetry.
        service.firstSeen = new Date();
        service.lastSeen = new Date();
        await this.serviceRepository.save(service);

        this.logger.log(`🔍 Discovered new service: ${name} in ${namespace}`);

        try {
          await this.crdService.upsertSecurityProfile({
            serviceName: name,
            namespace,
            baseline: {
              requestsPerSecond: 0,
              errorRate: 0,
              avgLatencyMs: 0,
            },
            allowedSources: [],
            allowedDestinations: [],
            knownEndpoints: [],
          });

          this.logger.debug(`Created SecurityProfile CRD for ${name}`);
        } catch (error) {
          this.logger.warn(`Failed to create SecurityProfile for ${name}: ${error.message}`);
        }
      }
    } catch (error) {
      this.logger.error(`Failed to handle deployment ${name}: ${error.message}`);
    }
  }

  /**
   * Handle a DELETED deployment event.
   *
   * We do NOT remove the `services` row — historical analysis needs to
   * know that the service once existed. A future enhancement could flip
   * a status flag instead.
   */
  private async handleDeploymentDeleted(deployment: k8s.V1Deployment) {
    const name = deployment.metadata?.name;
    if (!name) return;

    this.logger.log(`Service deployment deleted: ${name} (keeping historical record)`);
  }

  /**
   * Resolve monitored namespaces from `K8S_WATCH_NAMESPACES`.
   *
   * `all` → every namespace except system/control-plane/zentrion ones;
   * otherwise a comma-separated list.
   */
  private async getMonitoredNamespaces(): Promise<string[]> {
    const watchNamespaces = this.configService.get('K8S_WATCH_NAMESPACES', 'all');

    if (watchNamespaces === 'all') {
      const allNamespaces = await this.k8sService.getNamespaces();
      return allNamespaces.filter(
        (ns) => !['kube-system', 'kube-public', 'kube-node-lease', 'istio-system', 'zentrion-system'].includes(ns),
      );
    } else {
      return watchNamespaces.split(',').map((ns) => ns.trim());
    }
  }

  /**
   * Return every discovered service, most-recently-seen first.
   *
   * Consumed by the dashboard's service list view.
   */
  async getAllServices(): Promise<ServiceEntity[]> {
    return await this.serviceRepository.find({
      order: {
        lastSeen: 'DESC',
      },
    });
  }

  /**
   * Fetch a single service by name. Returns `null` if missing.
   */
  async getService(name: string): Promise<ServiceEntity | null> {
    return await this.serviceRepository.findOne({ where: { name } });
  }

  /**
   * Merge newly observed dependencies into a service's known set.
   *
   * Called by telemetry processing — de-duplicates to keep the list stable
   * even when the same edge is observed many times.
   *
   * @param serviceName  Source service.
   * @param dependencies Downstream services to record.
   */
  async updateServiceDependencies(serviceName: string, dependencies: string[]) {
    const service = await this.serviceRepository.findOne({ where: { name: serviceName } });
    if (service) {
      const uniqueDeps = Array.from(new Set([...service.dependencies, ...dependencies]));
      service.dependencies = uniqueDeps;
      await this.serviceRepository.save(service);
    }
  }

  /**
   * Abort every active watcher. Safe to call multiple times.
   */
  private stopWatching() {
    this.logger.log('Stopping all deployment watchers...');

    for (const [namespace, watcher] of this.watchers.entries()) {
      try {
        watcher.abort();
        this.logger.debug(`Stopped watcher for ${namespace}`);
      } catch (error) {
        this.logger.error(`Failed to stop watcher for ${namespace}: ${error.message}`);
      }
    }
    this.watchers.clear();

    this.logger.log('✅ All deployment watchers stopped');
  }
}
