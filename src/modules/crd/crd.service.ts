import { Injectable, Logger } from '@nestjs/common';
import { K8sService } from '../k8s/k8s.service';

/**
 * Zentrion CRD Management Service
 * Manages SecurityProfile, PolicyHistory, and AnomalyRecord CRDs
 */
@Injectable()
export class CrdService {
  private readonly logger = new Logger(CrdService.name);

  constructor(private k8sService: K8sService) {}

  // ============================================
  // SECURITY PROFILE CRD
  // ============================================

  /**
   * Create or update SecurityProfile
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

      // Try to get existing
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
        // Update
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
        // Create
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
   * Get SecurityProfile
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
   * List all SecurityProfiles
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
   * Create AnomalyRecord
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
   * Update AnomalyRecord status
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
   * List AnomalyRecords
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
   * Create PolicyHistory entry
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
          name: `history-${policyId.substring(0, 8)}-${Date.now()}`,
          namespace: 'zentrion-system', // Store all history in zentrion-system
        },
        spec: {
          policyId,
          namespace, // Target namespace
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
   * List PolicyHistory
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
