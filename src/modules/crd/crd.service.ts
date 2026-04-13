import { Injectable, Logger } from '@nestjs/common';
import { K8sService } from '../k8s/k8s.service';

/**
 * Zentrion CRD management service.
 *
 * Provides CRUD helpers against the three `zentrion.io/v1alpha1` custom
 * resources that live alongside the relational tables:
 *  - `SecurityProfile` — per-service behavioural baseline + allowed peers.
 *  - `AnomalyRecord`   — K8s-native mirror of the `anomalies` table.
 *  - `PolicyHistory`   — K8s-native mirror of the `policy_history` table.
 *
 * Storing this state as CRDs lets operators inspect it with standard
 * `kubectl` tooling and satisfies the FYP requirement of demonstrating
 * K8s extension mechanisms (custom API groups).
 */
@Injectable()
export class CrdService {
  private readonly logger = new Logger(CrdService.name);

  constructor(private k8sService: K8sService) {}

  // ============================================
  // SECURITY PROFILE CRD
  // ============================================

  /**
   * Create or update a `SecurityProfile` for a service.
   *
   * Seeded at service-discovery time with empty baselines and updated as
   * telemetry accumulates. Uses a merge-patch on existing profiles so
   * status fields set by controllers are preserved.
   *
   * @param profile Profile payload. `serviceName`+`namespace` identify the CR.
   * @returns The created or patched resource body.
   */
  async upsertSecurityProfile(profile: {
    serviceName: string;
    namespace: string;
    baseline?: any;
    allowedSources?: any[];
    allowedDestinations?: any[];
    knownEndpoints?: any[];
  }) {
    try {
      const customApi = this.k8sService.getCustomApi();
      const { serviceName, namespace, ...spec } = profile;

      const resource = {
        apiVersion: 'zentrion.io/v1alpha1',
        kind: 'SecurityProfile',
        metadata: {
          name: `${serviceName}-profile`,
          namespace,
        },
        spec: {
          serviceName,
          namespace,
          ...spec,
          learningPeriod: {
            status: 'active',
          },
        },
      };

      const existing = await customApi
        .getNamespacedCustomObject(
          'zentrion.io',
          'v1alpha1',
          namespace,
          'securityprofiles',
          resource.metadata.name,
        )
        .catch(() => null);

      if (existing) {
        const result = await customApi.patchNamespacedCustomObject(
          'zentrion.io',
          'v1alpha1',
          namespace,
          'securityprofiles',
          resource.metadata.name,
          resource,
          undefined,
          undefined,
          undefined,
          { headers: { 'Content-Type': 'application/merge-patch+json' } },
        );
        this.logger.debug(`Updated SecurityProfile: ${serviceName}`);
        return result.body;
      } else {
        const result = await customApi.createNamespacedCustomObject(
          'zentrion.io',
          'v1alpha1',
          namespace,
          'securityprofiles',
          resource,
        );
        this.logger.log(`Created SecurityProfile: ${serviceName}`);
        return result.body;
      }
    } catch (error) {
      this.logger.error(`Failed to upsert SecurityProfile: ${error.message}`);
      throw error;
    }
  }

  /**
   * Fetch a single `SecurityProfile` by service + namespace.
   *
   * @returns The resource body, or `null` if it does not exist (404).
   */
  async getSecurityProfile(serviceName: string, namespace: string) {
    try {
      const customApi = this.k8sService.getCustomApi();
      const result = await customApi.getNamespacedCustomObject(
        'zentrion.io',
        'v1alpha1',
        namespace,
        'securityprofiles',
        `${serviceName}-profile`,
      );
      return result.body;
    } catch (error) {
      if (error.response?.statusCode === 404) {
        return null;
      }
      this.logger.error(`Failed to get SecurityProfile: ${error.message}`);
      throw error;
    }
  }

  /**
   * List `SecurityProfile` resources.
   *
   * @param namespace Optional scope — if omitted, lists across the cluster.
   * @returns Array of resources (empty on error — logs the failure).
   */
  async listSecurityProfiles(namespace?: string) {
    try {
      const customApi = this.k8sService.getCustomApi();

      let result;
      if (namespace) {
        result = await customApi.listNamespacedCustomObject(
          'zentrion.io',
          'v1alpha1',
          namespace,
          'securityprofiles',
        );
      } else {
        result = await customApi.listClusterCustomObject(
          'zentrion.io',
          'v1alpha1',
          'securityprofiles',
        );
      }

      return (result.body as any).items || [];
    } catch (error) {
      this.logger.error(`Failed to list SecurityProfiles: ${error.message}`);
      return [];
    }
  }

  // ============================================
  // ANOMALY RECORD CRD
  // ============================================

  /**
   * Create an `AnomalyRecord` mirroring a row from the `anomalies` table.
   *
   * The name is derived from the first 8 chars of the UUID — enough to
   * disambiguate in practice while staying within K8s name length limits.
   *
   * @returns The created resource body.
   */
  async createAnomalyRecord(anomaly: {
    anomalyId: string;
    type: string;
    severity: string;
    serviceName: string;
    namespace: string;
    detectedAt: string;
    details: string;
    evidence?: any;
    associatedLogs?: string[];
    suggestedPolicyId?: string;
  }) {
    try {
      const customApi = this.k8sService.getCustomApi();
      const { anomalyId, namespace, ...spec } = anomaly;

      const resource = {
        apiVersion: 'zentrion.io/v1alpha1',
        kind: 'AnomalyRecord',
        metadata: {
          name: `anomaly-${anomalyId.substring(0, 8)}`,
          namespace,
        },
        spec: {
          anomalyId,
          ...spec,
        },
        status: {
          state: 'active',
          policyApplied: false,
          occurrenceCount: 1,
          lastOccurrence: new Date().toISOString(),
        },
      };

      const result = await customApi.createNamespacedCustomObject(
        'zentrion.io',
        'v1alpha1',
        namespace,
        'anomalyrecords',
        resource,
      );

      this.logger.log(`Created AnomalyRecord: ${anomalyId}`);
      return result.body;
    } catch (error) {
      this.logger.error(`Failed to create AnomalyRecord: ${error.message}`);
      throw error;
    }
  }

  /**
   * Patch the `status` subresource of an `AnomalyRecord`.
   *
   * Used when a generated policy is applied ("policyApplied: true") or when
   * the state transitions to `resolved`.
   *
   * @param anomalyId UUID of the source anomaly.
   * @param namespace Namespace the CR lives in.
   * @param status    Fields to merge into the status subresource.
   */
  async updateAnomalyRecordStatus(
    anomalyId: string,
    namespace: string,
    status: {
      state?: string;
      policyApplied?: boolean;
      appliedPolicyName?: string;
    },
  ) {
    try {
      const customApi = this.k8sService.getCustomApi();
      const name = `anomaly-${anomalyId.substring(0, 8)}`;

      const patch = {
        status,
      };

      const result = await customApi.patchNamespacedCustomObjectStatus(
        'zentrion.io',
        'v1alpha1',
        namespace,
        'anomalyrecords',
        name,
        patch,
        undefined,
        undefined,
        undefined,
        { headers: { 'Content-Type': 'application/merge-patch+json' } },
      );

      this.logger.debug(`Updated AnomalyRecord status: ${anomalyId}`);
      return result.body;
    } catch (error) {
      this.logger.error(`Failed to update AnomalyRecord status: ${error.message}`);
      throw error;
    }
  }

  /**
   * List `AnomalyRecord` resources.
   *
   * @param namespace Optional namespace filter; omit for cluster-wide.
   */
  async listAnomalyRecords(namespace?: string) {
    try {
      const customApi = this.k8sService.getCustomApi();

      let result;
      if (namespace) {
        result = await customApi.listNamespacedCustomObject(
          'zentrion.io',
          'v1alpha1',
          namespace,
          'anomalyrecords',
        );
      } else {
        result = await customApi.listClusterCustomObject(
          'zentrion.io',
          'v1alpha1',
          'anomalyrecords',
        );
      }

      return (result.body as any).items || [];
    } catch (error) {
      this.logger.error(`Failed to list AnomalyRecords: ${error.message}`);
      return [];
    }
  }

  // ============================================
  // POLICY HISTORY CRD
  // ============================================

  /**
   * Create a `PolicyHistory` entry recording a lifecycle action
   * (created / approved / rejected / applied / deleted).
   *
   * All history resources are stored in `zentrion-system` (rather than the
   * policy's target namespace) so the full audit trail lives in one place
   * and can be queried regardless of where the policies were applied.
   */
  async createPolicyHistory(history: {
    policyId: string;
    policyName: string;
    action: string;
    timestamp: string;
    userId: string;
    userName: string;
    userRole: string;
    details: string;
    reason?: string;
    serviceName: string;
    namespace: string;
    policyYaml?: string;
  }) {
    try {
      const customApi = this.k8sService.getCustomApi();
      const { policyId, namespace, ...spec } = history;

      const resource = {
        apiVersion: 'zentrion.io/v1alpha1',
        kind: 'PolicyHistory',
        metadata: {
          // Epoch suffix prevents name collisions on rapid successive actions.
          name: `history-${policyId.substring(0, 8)}-${Date.now()}`,
          namespace: 'zentrion-system',
        },
        spec: {
          policyId,
          namespace, // Target namespace the policy applies to.
          ...spec,
        },
        status: {
          recorded: true,
          recordedAt: new Date().toISOString(),
        },
      };

      const result = await customApi.createNamespacedCustomObject(
        'zentrion.io',
        'v1alpha1',
        'zentrion-system',
        'policyhistories',
        resource,
      );

      this.logger.debug(`Created PolicyHistory: ${policyId} - ${spec.action}`);
      return result.body;
    } catch (error) {
      this.logger.error(`Failed to create PolicyHistory: ${error.message}`);
      throw error;
    }
  }

  /**
   * List `PolicyHistory` entries — optionally filtered to a single policy.
   *
   * @param policyId Optional filter; returns only entries whose
   *                 `spec.policyId` matches.
   */
  async listPolicyHistory(policyId?: string) {
    try {
      const customApi = this.k8sService.getCustomApi();

      const result = await customApi.listNamespacedCustomObject(
        'zentrion.io',
        'v1alpha1',
        'zentrion-system',
        'policyhistories',
      );

      let items = (result.body as any).items || [];

      if (policyId) {
        items = items.filter((item: any) => item.spec.policyId === policyId);
      }

      return items;
    } catch (error) {
      this.logger.error(`Failed to list PolicyHistory: ${error.message}`);
      return [];
    }
  }
}
