/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/require-await */
import { Injectable, Logger } from '@nestjs/common';
import { store } from '../../common/store';
import { AppliedManifest } from '../../common/types';
import { v4 as uuidv4 } from 'uuid';
import * as yaml from 'js-yaml';

/**
 * Mock Kubernetes service that simulates applying manifests
 * In production, this would use @kubernetes/client-node
 */
@Injectable()
export class K8sService {
  private readonly logger = new Logger(K8sService.name);

  /**
   * Apply a manifest to the cluster (simulated)
   * In production: use k8sApi.createNamespacedCustomObject() or similar
   */
  async applyManifest(
    yamlContent: string,
    appliedBy: string,
  ): Promise<AppliedManifest> {
    try {
      // Parse YAML
      const manifest: any = yaml.load(yamlContent);

      if (!manifest || !manifest.metadata) {
        throw new Error('Invalid manifest: missing metadata');
      }

      // Create applied manifest record
      const appliedManifest: AppliedManifest = {
        id: uuidv4(),
        kind: manifest.kind,
        apiVersion: manifest.apiVersion,
        metadata: {
          name: manifest.metadata.name,
          namespace: manifest.metadata.namespace || 'default',
        },
        spec: manifest.spec,
        appliedAt: new Date().toISOString(),
        appliedBy,
        status: 'active',
      };

      // Store in memory
      store.addAppliedManifest(appliedManifest);

      // Log the operation
      this.logger.log(
        `[SIMULATED] Applied ${manifest.kind} "${manifest.metadata.name}" to namespace "${appliedManifest.metadata.namespace}"`,
      );
      this.logger.debug(`Manifest content:\n${yamlContent}`);

      return appliedManifest;
    } catch (error) {
      this.logger.error(`Failed to apply manifest: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get all applied manifests
   */
  getAllAppliedManifests(): AppliedManifest[] {
    return store.getAllAppliedManifests();
  }

  /**
   * Get a specific manifest by ID
   */
  getAppliedManifest(id: string): AppliedManifest | undefined {
    return store.getAppliedManifest(id);
  }

  /**
   * Delete a manifest (mark as deleted)
   */
  deleteManifest(id: string): boolean {
    const manifest = store.getAppliedManifest(id);
    if (manifest) {
      manifest.status = 'deleted';
      this.logger.log(
        `[SIMULATED] Deleted ${manifest.kind} "${manifest.metadata.name}"`,
      );
      return true;
    }
    return false;
  }

  /**
   * Simulate checking if a manifest exists
   */
  manifestExists(name: string, namespace: string, kind: string): boolean {
    const manifests = store.getAllAppliedManifests();
    return manifests.some(
      (m) =>
        m.metadata.name === name &&
        m.metadata.namespace === namespace &&
        m.kind === kind &&
        m.status === 'active',
    );
  }
}
