import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as k8s from '@kubernetes/client-node';
import * as yaml from 'js-yaml';

/**
 * Real Kubernetes client service.
 *
 * Establishes a connection to the cluster on boot and exposes:
 *  - high-level helpers (`applyManifest`, list methods);
 *  - the raw API clients (`getK8sApi`, `getAppsApi`, `getCustomApi`, ...)
 *    so other services (Istio watcher, CRD manager, service discovery)
 *    can issue bespoke calls without each creating their own client.
 *
 * Connection mode is governed by `K8S_IN_CLUSTER`:
 *  - `true`  → loads the pod's service-account config (production path).
 *  - `false` → loads the default kubeconfig (developer workstation).
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

  /**
   * Nest lifecycle hook — triggered after the module is instantiated.
   * Initializes the K8s client so later route/event handlers can rely on it.
   */
  async onModuleInit() {
    await this.initializeClient();
  }

  /**
   * Load kubeconfig (in-cluster or default), instantiate the typed API
   * clients, and confirm connectivity. Any failure here re-throws so the
   * pod crashes rather than silently running without K8s access.
   */
  private async initializeClient() {
    this.kc = new k8s.KubeConfig();
    this.inCluster =
      this.configService.get('K8S_IN_CLUSTER', 'false') === 'true';

    try {
      if (this.inCluster) {
        this.kc.loadFromCluster();
        this.logger.log(
          '✅ Loaded Kubernetes config from cluster (ServiceAccount)',
        );
      } else {
        this.kc.loadFromDefault();
        this.logger.log('✅ Loaded Kubernetes config from kubeconfig');
      }

      this.k8sApi = this.kc.makeApiClient(k8s.CoreV1Api);
      this.appsApi = this.kc.makeApiClient(k8s.AppsV1Api);
      this.customApi = this.kc.makeApiClient(k8s.CustomObjectsApi);
      this.networkingApi = this.kc.makeApiClient(k8s.NetworkingV1Api);

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
   * Hit the API server with a cheap discovery call to confirm the
   * credentials and network path are good. Called once from `onModuleInit`.
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
   * Apply (create or update) a YAML manifest to the cluster.
   *
   * Currently supports the Istio security/networking kinds that the policy
   * builder emits: `AuthorizationPolicy`, `PeerAuthentication`,
   * `RequestAuthentication`, `DestinationRule`. Other kinds raise an error
   * rather than being silently ignored.
   *
   * @param yamlContent Raw YAML string to apply.
   * @param appliedBy  User id recorded in the audit trail.
   * @returns Summary of the applied object (kind/name/namespace + audit metadata).
   * @throws Error when the manifest is malformed or the kind is unsupported.
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
   * Upsert an Istio `AuthorizationPolicy` custom resource.
   *
   * Uses merge-patch semantics on update so unrelated fields (e.g. status
   * added by controllers) are preserved.
   */
  private async applyAuthorizationPolicy(manifest: any, namespace: string) {
    try {
      // Probe for an existing object; swallow the 404 by catching.
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
   * Upsert an Istio `PeerAuthentication` custom resource (controls mTLS mode).
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
   * Upsert an Istio `RequestAuthentication` custom resource (JWT validation config).
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
   * Upsert an Istio `DestinationRule` custom resource (traffic-policy config).
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
   * List every namespace visible to the service account.
   *
   * @returns Array of namespace names (namespaces with no `metadata.name` are
   *          filtered out — defensive against partial API responses).
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
   * List pods in a namespace.
   *
   * @param namespace Target namespace (defaults to `default`).
   * @returns Raw `V1Pod` objects, or `[]` on error.
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
   * List deployments in a namespace.
   *
   * @param namespace Target namespace (defaults to `default`).
   * @returns Raw `V1Deployment` objects, or `[]` on error.
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
   * List services in a namespace.
   *
   * @param namespace Target namespace (defaults to `default`).
   * @returns Raw `V1Service` objects, or `[]` on error.
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

  /** Accessor for `CoreV1Api` (pods, services, namespaces, ...). */
  getK8sApi() {
    return this.k8sApi;
  }

  /** Accessor for `AppsV1Api` (deployments, statefulsets, ...). */
  getAppsApi() {
    return this.appsApi;
  }

  /** Accessor for `CustomObjectsApi` (CRDs — Istio resources, Zentrion CRDs). */
  getCustomApi() {
    return this.customApi;
  }

  /** Accessor for `NetworkingV1Api` (NetworkPolicies, Ingress, ...). */
  getNetworkingApi() {
    return this.networkingApi;
  }

  /** Accessor for the underlying `KubeConfig` (needed by the log watcher). */
  getKubeConfig() {
    return this.kc;
  }
}
