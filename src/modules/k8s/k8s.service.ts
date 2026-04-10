import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as k8s from '@kubernetes/client-node';
import * as yaml from 'js-yaml';

/**
 * Real Kubernetes client service
 * Connects to cluster using in-cluster config or kubeconfig
 */
@Injectable()
export class K8sService implements OnModuleInit {
  private readonly logger = new Logger(K8sService.name);

  private kc: k8s.KubeConfig;
  private k8sApi: k8s.CoreV1Api;
  private appsApi: k8s.AppsV1Api;
  private customApi: k8s.CustomObjectsApi;
  private networkingApi: k8s.NetworkingV1Api;

  private inCluster: boolean;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    await this.initializeClient();
  }

  /**
   * Initialize Kubernetes client
   */
  private async initializeClient() {
    this.kc = new k8s.KubeConfig();
    this.inCluster =
      this.configService.get('K8S_IN_CLUSTER', 'false') === 'true';

    try {
      if (this.inCluster) {
        // Running inside a Kubernetes pod
        this.kc.loadFromCluster();
        this.logger.log(
          '✅ Loaded Kubernetes config from cluster (ServiceAccount)',
        );
      } else {
        // Running locally, use kubeconfig
        this.kc.loadFromDefault();
        this.logger.log('✅ Loaded Kubernetes config from kubeconfig');
      }

      // Initialize API clients
      this.k8sApi = this.kc.makeApiClient(k8s.CoreV1Api);
      this.appsApi = this.kc.makeApiClient(k8s.AppsV1Api);
      this.customApi = this.kc.makeApiClient(k8s.CustomObjectsApi);
      this.networkingApi = this.kc.makeApiClient(k8s.NetworkingV1Api);

      // Test connection
      await this.testConnection();
    } catch (error) {
      this.logger.error(
        '❌ Failed to initialize Kubernetes client:',
        error.message,
      );
      throw error;
    }
  }

  /**
   * Test cluster connectivity
   */
  private async testConnection() {
    try {
      const version = await this.k8sApi.getAPIResources();
      this.logger.log(
        `✅ Connected to Kubernetes cluster (API version: ${version.body.apiVersion})`,
      );
    } catch (error) {
      this.logger.error(
        '❌ Failed to connect to Kubernetes cluster:',
        error.message,
      );
      throw error;
    }
  }

  /**
   * Apply a manifest (YAML) to the cluster
   */
  async applyManifest(yamlContent: string, appliedBy: string): Promise<any> {
    try {
      const manifest: any = yaml.load(yamlContent);

      if (!manifest || !manifest.metadata) {
        throw new Error('Invalid manifest: missing metadata');
      }

      const { kind, apiVersion, metadata, spec } = manifest;
      const namespace = metadata.namespace || 'default';

      this.logger.log(
        `Applying ${kind} "${metadata.name}" to namespace "${namespace}"`,
      );

      let result;

      switch (kind) {
        case 'AuthorizationPolicy':
          result = await this.applyAuthorizationPolicy(manifest, namespace);
          break;

        case 'PeerAuthentication':
          result = await this.applyPeerAuthentication(manifest, namespace);
          break;

        case 'RequestAuthentication':
          result = await this.applyRequestAuthentication(manifest, namespace);
          break;

        case 'DestinationRule':
          result = await this.applyDestinationRule(manifest, namespace);
          break;

        default:
          throw new Error(`Unsupported manifest kind: ${kind}`);
      }

      this.logger.log(`✅ Applied ${kind} "${metadata.name}" successfully`);

      return {
        kind,
        name: metadata.name,
        namespace,
        appliedAt: new Date().toISOString(),
        appliedBy,
        status: 'applied',
      };
    } catch (error) {
      this.logger.error(`Failed to apply manifest: ${error.message}`);
      throw error;
    }
  }

  /**
   * Apply Istio AuthorizationPolicy
   */
  private async applyAuthorizationPolicy(manifest: any, namespace: string) {
    try {
      // Try to get existing policy
      const existing = await this.customApi
        .getNamespacedCustomObject(
          'security.istio.io',
          'v1beta1',
          namespace,
          'authorizationpolicies',
          manifest.metadata.name,
        )
        .catch(() => null);

      if (existing) {
        // Update existing
        return await this.customApi.patchNamespacedCustomObject(
          'security.istio.io',
          'v1beta1',
          namespace,
          'authorizationpolicies',
          manifest.metadata.name,
          manifest,
          undefined,
          undefined,
          undefined,
          { headers: { 'Content-Type': 'application/merge-patch+json' } },
        );
      } else {
        // Create new
        return await this.customApi.createNamespacedCustomObject(
          'security.istio.io',
          'v1beta1',
          namespace,
          'authorizationpolicies',
          manifest,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to apply AuthorizationPolicy: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Apply Istio PeerAuthentication
   */
  private async applyPeerAuthentication(manifest: any, namespace: string) {
    try {
      const existing = await this.customApi
        .getNamespacedCustomObject(
          'security.istio.io',
          'v1beta1',
          namespace,
          'peerauthentications',
          manifest.metadata.name,
        )
        .catch(() => null);

      if (existing) {
        return await this.customApi.patchNamespacedCustomObject(
          'security.istio.io',
          'v1beta1',
          namespace,
          'peerauthentications',
          manifest.metadata.name,
          manifest,
          undefined,
          undefined,
          undefined,
          { headers: { 'Content-Type': 'application/merge-patch+json' } },
        );
      } else {
        return await this.customApi.createNamespacedCustomObject(
          'security.istio.io',
          'v1beta1',
          namespace,
          'peerauthentications',
          manifest,
        );
      }
    } catch (error) {
      this.logger.error(`Failed to apply PeerAuthentication: ${error.message}`);
      throw error;
    }
  }

  /**
   * Apply Istio RequestAuthentication
   */
  private async applyRequestAuthentication(manifest: any, namespace: string) {
    try {
      const existing = await this.customApi
        .getNamespacedCustomObject(
          'security.istio.io',
          'v1beta1',
          namespace,
          'requestauthentications',
          manifest.metadata.name,
        )
        .catch(() => null);

      if (existing) {
        return await this.customApi.patchNamespacedCustomObject(
          'security.istio.io',
          'v1beta1',
          namespace,
          'requestauthentications',
          manifest.metadata.name,
          manifest,
          undefined,
          undefined,
          undefined,
          { headers: { 'Content-Type': 'application/merge-patch+json' } },
        );
      } else {
        return await this.customApi.createNamespacedCustomObject(
          'security.istio.io',
          'v1beta1',
          namespace,
          'requestauthentications',
          manifest,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to apply RequestAuthentication: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Apply Istio DestinationRule
   */
  private async applyDestinationRule(manifest: any, namespace: string) {
    try {
      const existing = await this.customApi
        .getNamespacedCustomObject(
          'networking.istio.io',
          'v1beta1',
          namespace,
          'destinationrules',
          manifest.metadata.name,
        )
        .catch(() => null);

      if (existing) {
        return await this.customApi.patchNamespacedCustomObject(
          'networking.istio.io',
          'v1beta1',
          namespace,
          'destinationrules',
          manifest.metadata.name,
          manifest,
          undefined,
          undefined,
          undefined,
          { headers: { 'Content-Type': 'application/merge-patch+json' } },
        );
      } else {
        return await this.customApi.createNamespacedCustomObject(
          'networking.istio.io',
          'v1beta1',
          namespace,
          'destinationrules',
          manifest,
        );
      }
    } catch (error) {
      this.logger.error(`Failed to apply DestinationRule: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get all namespaces
   */
  async getNamespaces(): Promise<string[]> {
    try {
      const response = await this.k8sApi.listNamespace();
      return response.body.items
        .filter((ns) => ns.metadata?.name)
        .map((ns) => ns.metadata!.name!);
    } catch (error) {
      this.logger.error(`Failed to list namespaces: ${error.message}`);
      return [];
    }
  }

  /**
   * Get all pods in a namespace
   */
  async getPods(namespace: string = 'default') {
    try {
      const response = await this.k8sApi.listNamespacedPod(namespace);
      return response.body.items;
    } catch (error) {
      this.logger.error(`Failed to list pods: ${error.message}`);
      return [];
    }
  }

  /**
   * Get all deployments in a namespace
   */
  async getDeployments(namespace: string = 'default') {
    try {
      const response = await this.appsApi.listNamespacedDeployment(namespace);
      return response.body.items;
    } catch (error) {
      this.logger.error(`Failed to list deployments: ${error.message}`);
      return [];
    }
  }

  /**
   * Get all services in a namespace
   */
  async getServices(namespace: string = 'default') {
    try {
      const response = await this.k8sApi.listNamespacedService(namespace);
      return response.body.items;
    } catch (error) {
      this.logger.error(`Failed to list services: ${error.message}`);
      return [];
    }
  }

  /**
   * Expose API clients for other services
   */
  getK8sApi() {
    return this.k8sApi;
  }

  getAppsApi() {
    return this.appsApi;
  }

  getCustomApi() {
    return this.customApi;
  }

  getNetworkingApi() {
    return this.networkingApi;
  }

  getKubeConfig() {
    return this.kc;
  }
}
