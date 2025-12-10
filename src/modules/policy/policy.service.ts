/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { store } from '../../common/store';
import {
  PolicyDraft,
  PolicyHistory,
  Anomaly,
  AuthorizationRule,
} from '../../common/types';
import { v4 as uuidv4 } from 'uuid';
import { K8sService } from '../k8s/k8s.service';
import { buildAuthorizationPolicy } from '../k8s/istio.builder';

@Injectable()
export class PolicyService {
  private readonly logger = new Logger(PolicyService.name);
  private eventEmitter: any;

  constructor(private k8sService: K8sService) {}

  setEventEmitter(emitter: any) {
    this.eventEmitter = emitter;
  }

  // Generate policy draft from anomaly
  generatePolicyFromAnomaly(anomaly: Anomaly, userId: string): PolicyDraft {
    const rules = this.generateRulesFromAnomaly(anomaly);
    const yaml = buildAuthorizationPolicy(
      anomaly.service,
      'default',
      rules,
      `Generated from anomaly: ${anomaly.type}`,
    );

    const draft: PolicyDraft = {
      id: uuidv4(),
      createdAt: new Date().toISOString(),
      createdBy: userId,
      service: anomaly.service,
      namespace: 'default',
      yaml,
      status: 'pending',
      reason: `Auto-generated from ${anomaly.type} anomaly: ${anomaly.details}`,
      anomalyId: anomaly.id,
    };

    store.addPolicyDraft(draft);
    this.addHistory(
      draft.id,
      'created',
      userId,
      'Policy draft created from anomaly',
    );

    // Emit event
    if (this.eventEmitter) {
      this.eventEmitter('policy.draft', draft);
    }

    this.logger.log(
      `Policy draft created: ${draft.id} for service ${draft.service}`,
    );
    return draft;
  }

  // Generate rules based on anomaly type
  private generateRulesFromAnomaly(anomaly: Anomaly): AuthorizationRule[] {
    switch (anomaly.type) {
      case 'UNUSUAL_SOURCE': {
        // Block specific IP
        const ipMatch = anomaly.details.match(/(\d+\.\d+\.\d+\.\d+)/);
        const ip = ipMatch ? ipMatch[1] : '192.0.2.0/24';
        return [
          {
            from: {
              source: {
                ipBlocks: [ip],
              },
            },
            to: {
              operation: {
                methods: ['*'],
              },
            },
          },
        ];
      }

      case 'UNEXPECTED_COMMUNICATION': {
        // Restrict source service communication
        const match = anomaly.details.match(/(\w+)\s*->\s*(\w+)/);
        const sourceService = match ? match[1] : 'unknown';
        return [
          {
            from: {
              source: {
                principals: [`cluster.local/ns/default/sa/${sourceService}`],
              },
            },
            to: {
              operation: {
                methods: ['*'],
              },
            },
          },
        ];
      }

      case 'NEW_ENDPOINT': {
        // Allow only known endpoints
        const pathMatch = anomaly.details.match(/(\/[\w/]+)/);
        const path = pathMatch ? pathMatch[1] : '/api/*';
        return [
          {
            to: {
              operation: {
                paths: [path],
                methods: ['GET', 'POST'],
              },
            },
          },
        ];
      }

      case 'HIGH_ERROR_RATE':
      case 'UNAUTHORIZED_ACCESS': {
        // Rate limiting rule
        return [
          {
            to: {
              operation: {
                methods: ['*'],
              },
            },
            when: [
              {
                key: 'request.headers[x-forwarded-for]',
                values: ['*'],
              },
            ],
          },
        ];
      }

      case 'SUSPICIOUS_PATTERN': {
        // Block IP if detected in anomaly
        const ipMatch = anomaly.details.match(/IP\s+(\d+\.\d+\.\d+\.\d+)/);
        const ip = ipMatch ? ipMatch[1] : '0.0.0.0/0';
        return [
          {
            from: {
              source: {
                ipBlocks: [ip],
              },
            },
          },
        ];
      }

      default:
        return [
          {
            to: {
              operation: {
                methods: ['GET', 'POST', 'PUT', 'DELETE'],
              },
            },
          },
        ];
    }
  }

  // Create manual policy draft
  createDraft(params: {
    service: string;
    namespace: string;
    rules: AuthorizationRule[];
    reason: string;
    userId: string;
  }): PolicyDraft {
    const yaml = buildAuthorizationPolicy(
      params.service,
      params.namespace,
      params.rules,
      params.reason,
    );

    const draft: PolicyDraft = {
      id: uuidv4(),
      createdAt: new Date().toISOString(),
      createdBy: params.userId,
      service: params.service,
      namespace: params.namespace,
      yaml,
      status: 'pending',
      reason: params.reason,
    };

    store.addPolicyDraft(draft);
    this.addHistory(
      draft.id,
      'created',
      params.userId,
      'Manual policy draft created',
    );

    return draft;
  }

  // Approve and apply policy
  async approveDraft(draftId: string, userId: string): Promise<PolicyDraft> {
    const draft = store.getPolicyDraft(draftId);
    if (!draft) {
      throw new NotFoundException(`Policy draft ${draftId} not found`);
    }

    if (draft.status !== 'pending') {
      throw new BadRequestException(`Policy draft is already ${draft.status}`);
    }

    // Apply to K8s (mock)
    const result = await this.k8sService.applyManifest(draft.yaml, userId);

    // Update draft
    store.updatePolicyDraft(draftId, {
      status: 'applied',
      approvedBy: userId,
      appliedAt: new Date().toISOString(),
    });

    this.addHistory(draftId, 'approved', userId, 'Policy approved');
    this.addHistory(
      draftId,
      'applied',
      userId,
      `Applied to cluster: ${result.id}`,
    );

    const updatedDraft = store.getPolicyDraft(draftId);

    if (!updatedDraft) {
      throw new NotFoundException(`Policy draft ${draftId} not found`);
    }

    // Emit event
    if (this.eventEmitter) {
      this.eventEmitter('policy.applied', updatedDraft);
    }

    this.logger.log(`Policy ${draftId} approved and applied by ${userId}`);
    return updatedDraft;
  }

  // Reject policy draft
  rejectDraft(draftId: string, userId: string, reason: string): PolicyDraft {
    const draft = store.getPolicyDraft(draftId);
    if (!draft) {
      throw new NotFoundException(`Policy draft ${draftId} not found`);
    }

    if (draft.status !== 'pending') {
      throw new BadRequestException(`Policy draft is already ${draft.status}`);
    }

    store.updatePolicyDraft(draftId, {
      status: 'rejected',
      rejectedBy: userId,
      rejectionReason: reason,
    });

    this.addHistory(draftId, 'rejected', userId, reason);

    this.logger.log(`Policy ${draftId} rejected by ${userId}`);
    const updatedDraft = store.getPolicyDraft(draftId);

    if (!updatedDraft) {
      throw new NotFoundException(`Policy draft ${draftId} not found`);
    }
    return updatedDraft;
  }

  // Get all drafts
  getAllDrafts(): PolicyDraft[] {
    return store.getAllPolicyDrafts();
  }

  // Get pending drafts
  getPendingDrafts(): PolicyDraft[] {
    return store.getPendingDrafts();
  }

  // Get active policies
  getActivePolicies(): PolicyDraft[] {
    return store.getActivePolicies();
  }

  // Get single draft
  getDraft(id: string): PolicyDraft | undefined {
    return store.getPolicyDraft(id);
  }

  // Get policy history
  getHistory(policyId?: string): PolicyHistory[] {
    return store.getPolicyHistory(policyId);
  }

  // Add history entry
  private addHistory(
    policyId: string,
    action: PolicyHistory['action'],
    userId: string,
    details: string,
  ) {
    const history: PolicyHistory = {
      id: uuidv4(),
      policyId,
      action,
      timestamp: new Date().toISOString(),
      userId,
      details,
    };
    store.addPolicyHistory(history);
  }
}
