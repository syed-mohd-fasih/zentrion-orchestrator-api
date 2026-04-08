import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { K8sService } from '../k8s/k8s.service';
import { CrdService } from '../crd/crd.service';
import { Service as ServiceEntity } from '../database/entities/service.entity';
import * as k8s from '@kubernetes/client-node';

/**
 * Service Discovery Service
 * Watches Kubernetes Deployments and registers services in database + CRDs
 */
@Injectable()
export class ServiceDiscoveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ServiceDiscoveryService.name);
  private watchers: Map<string, any> = new Map();

  constructor(
    @InjectRepository(ServiceEntity)
    private serviceRepository: Repository<ServiceEntity>,
    private k8sService: K8sService,
    private crdService: CrdService,
    private configService: ConfigService,
  ) {}

  async onModuleInit() {
    await this.startWatching();
  }

  onModuleDestroy() {
    this.stopWatching();
  }

  /**
   * Start watching deployments across namespaces
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
   * Watch deployments in a namespace
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
            // Attempt to restart watcher
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
   * Handle discovered deployment
   */
  private async handleDeployment(deployment: k8s.V1Deployment) {
    const name = deployment.metadata?.name;
    const namespace = deployment.metadata?.namespace;
    const labels = deployment.metadata?.labels || {};

    if (!name || !namespace) return;

    try {
      // Check if service exists
      let service = await this.serviceRepository.findOne({ where: { name } });

      if (service) {
        // Update last seen
        service.lastSeen = new Date();
        service.labels = labels;
        await this.serviceRepository.save(service);
        
        this.logger.debug(`Updated service: ${name} in ${namespace}`);
      } else {
        // Create new service
        service = new ServiceEntity();
        service.name = name;
        service.namespace = namespace;
        service.labels = labels;
        service.dependencies = []; // Will be learned from telemetry
        service.firstSeen = new Date();
        service.lastSeen = new Date();
        await this.serviceRepository.save(service);

        this.logger.log(`🔍 Discovered new service: ${name} in ${namespace}`);

        // Create SecurityProfile CRD
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
   * Handle deleted deployment
   */
  private async handleDeploymentDeleted(deployment: k8s.V1Deployment) {
    const name = deployment.metadata?.name;
    if (!name) return;

    this.logger.log(`Service deployment deleted: ${name} (keeping historical record)`);
    // We keep the service record for historical purposes
    // Could optionally mark as deleted with a status field
  }

  /**
   * Get namespaces to monitor
   */
  private async getMonitoredNamespaces(): Promise<string[]> {
    const watchNamespaces = this.configService.get('K8S_WATCH_NAMESPACES', 'all');

    if (watchNamespaces === 'all') {
      const allNamespaces = await this.k8sService.getNamespaces();
      // Exclude system namespaces
      return allNamespaces.filter(
        (ns) => !['kube-system', 'kube-public', 'kube-node-lease', 'istio-system', 'zentrion-system'].includes(ns),
      );
    } else {
      return watchNamespaces.split(',').map((ns) => ns.trim());
    }
  }

  /**
   * Get all discovered services
   */
  async getAllServices(): Promise<ServiceEntity[]> {
    return await this.serviceRepository.find({
      order: {
        lastSeen: 'DESC',
      },
    });
  }

  /**
   * Get service by name
   */
  async getService(name: string): Promise<ServiceEntity | null> {
    return await this.serviceRepository.findOne({ where: { name } });
  }

  /**
   * Update service dependencies (learned from telemetry)
   */
  async updateServiceDependencies(serviceName: string, dependencies: string[]) {
    const service = await this.serviceRepository.findOne({ where: { name: serviceName } });
    if (service) {
      // Merge unique dependencies
      const uniqueDeps = Array.from(new Set([...service.dependencies, ...dependencies]));
      service.dependencies = uniqueDeps;
      await this.serviceRepository.save(service);
    }
  }

  /**
   * Stop all watchers
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
