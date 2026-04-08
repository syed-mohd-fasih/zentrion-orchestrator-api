import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { PolicyDraft } from '../database/entities/policy-draft.entity';
import { PolicyHistory } from '../database/entities/policy-history.entity';
import { Anomaly } from '../database/entities/anomaly.entity';
import { AuthorizationRule } from '../../common/types';
import { K8sService } from '../k8s/k8s.service';
import { buildAuthorizationPolicy } from '../k8s/istio.builder';

@Injectable()
export class PolicyService {
  private readonly logger = new Logger(PolicyService.name);
  private eventEmitter: ((event: string, data: any) => void) | null = null;

  constructor(
    @InjectRepository(PolicyDraft)
    private draftRepo: Repository<PolicyDraft>,
    @InjectRepository(PolicyHistory)
    private historyRepo: Repository<PolicyHistory>,
    @InjectRepository(Anomaly)
    private anomalyRepo: Repository<Anomaly>,
    private k8sService: K8sService,
  ) {}

  setEventEmitter(emitter: (event: string, data: any) => void) {
    this.eventEmitter = emitter;
  }

  async generatePolicyFromAnomaly(anomalyId: string, userId: string): Promise<PolicyDraft> {
    const anomaly = await this.anomalyRepo.findOne({ where: { anomalyId } });
    if (!anomaly) throw new NotFoundException(`Anomaly ${anomalyId} not found`);

    const rules = this.generateRulesFromAnomaly(anomaly);
    const yamlContent = buildAuthorizationPolicy(
      anomaly.service,
      'default',
      rules,
      `Generated from anomaly: ${anomaly.type}`,
    );

    const draft = new PolicyDraft();
    draft.draftId = uuidv4();
    draft.createdBy = userId;
    draft.service = anomaly.service;
    draft.namespace = 'default';
    draft.yamlContent = yamlContent;
    draft.status = 'pending';
    draft.reason = `Auto-generated from ${anomaly.type} anomaly: ${anomaly.details}`;
    draft.anomalyId = anomaly.anomalyId;

    await this.draftRepo.save(draft);
    await this.addHistory(draft.draftId, 'created', userId, 'Policy draft created from anomaly');

    if (this.eventEmitter) {
      this.eventEmitter('policy.draft', draft);
    }

    this.logger.log(`Policy draft created: ${draft.draftId} for service ${draft.service}`);
    return draft;
  }

  async createDraft(params: {
    service: string;
    namespace: string;
    rules: AuthorizationRule[];
    reason: string;
    userId: string;
  }): Promise<PolicyDraft> {
    const yamlContent = buildAuthorizationPolicy(
      params.service,
      params.namespace,
      params.rules,
      params.reason,
    );

    const draft = new PolicyDraft();
    draft.draftId = uuidv4();
    draft.createdBy = params.userId;
    draft.service = params.service;
    draft.namespace = params.namespace;
    draft.yamlContent = yamlContent;
    draft.status = 'pending';
    draft.reason = params.reason;

    await this.draftRepo.save(draft);
    await this.addHistory(draft.draftId, 'created', params.userId, 'Manual policy draft created');

    return draft;
  }

  async approveDraft(draftId: string, userId: string): Promise<PolicyDraft> {
    const draft = await this.draftRepo.findOne({ where: { draftId } });
    if (!draft) throw new NotFoundException(`Policy draft ${draftId} not found`);
    if (draft.status !== 'pending') {
      throw new BadRequestException(`Policy draft is already ${draft.status}`);
    }

    const result = await this.k8sService.applyManifest(draft.yamlContent, userId);

    draft.status = 'applied';
    draft.approvedBy = userId;
    draft.appliedAt = new Date();
    await this.draftRepo.save(draft);

    await this.addHistory(draftId, 'approved', userId, 'Policy approved');
    await this.addHistory(draftId, 'applied', userId, `Applied to cluster: ${result.id}`);

    if (this.eventEmitter) {
      this.eventEmitter('policy.applied', draft);
    }

    this.logger.log(`Policy ${draftId} approved and applied by ${userId}`);
    return draft;
  }

  async rejectDraft(draftId: string, userId: string, reason: string): Promise<PolicyDraft> {
    const draft = await this.draftRepo.findOne({ where: { draftId } });
    if (!draft) throw new NotFoundException(`Policy draft ${draftId} not found`);
    if (draft.status !== 'pending') {
      throw new BadRequestException(`Policy draft is already ${draft.status}`);
    }

    draft.status = 'rejected';
    draft.rejectedBy = userId;
    draft.rejectionReason = reason;
    await this.draftRepo.save(draft);

    await this.addHistory(draftId, 'rejected', userId, reason);

    this.logger.log(`Policy ${draftId} rejected by ${userId}`);
    return draft;
  }

  async getAllDrafts(): Promise<PolicyDraft[]> {
    return this.draftRepo.find({ order: { createdAt: 'DESC' } });
  }

  async getPendingDrafts(): Promise<PolicyDraft[]> {
    return this.draftRepo.find({ where: { status: 'pending' }, order: { createdAt: 'DESC' } });
  }

  async getActivePolicies(): Promise<PolicyDraft[]> {
    return this.draftRepo.find({ where: { status: 'applied' }, order: { appliedAt: 'DESC' } });
  }

  async getDraft(id: string): Promise<PolicyDraft | null> {
    return this.draftRepo.findOne({ where: { draftId: id } });
  }

  async getHistory(policyId?: string): Promise<PolicyHistory[]> {
    if (policyId) {
      return this.historyRepo.find({ where: { policyId }, order: { timestamp: 'DESC' } });
    }
    return this.historyRepo.find({ order: { timestamp: 'DESC' } });
  }

  private async addHistory(
    policyId: string,
    action: string,
    userId: string,
    details: string,
  ) {
    const history = new PolicyHistory();
    history.policyId = policyId;
    history.action = action;
    history.userId = userId;
    history.details = details;
    await this.historyRepo.save(history);
  }

  private generateRulesFromAnomaly(anomaly: Anomaly): AuthorizationRule[] {
    switch (anomaly.type) {
      case 'UNUSUAL_SOURCE':
      case 'SUSPICIOUS_PATTERN': {
        const ipMatch = anomaly.details.match(/(\d+\.\d+\.\d+\.\d+)/);
        const ip = ipMatch ? ipMatch[1] : '192.0.2.0/24';
        return [{ from: { source: { ipBlocks: [ip] } }, to: { operation: { methods: ['*'] } } }];
      }

      case 'UNEXPECTED_COMMUNICATION': {
        const match = anomaly.details.match(/(\S+)\s*->\s*(\S+)/);
        const sourceService = match ? match[1] : 'unknown';
        return [
          {
            from: { source: { principals: [`cluster.local/ns/default/sa/${sourceService}`] } },
            to: { operation: { methods: ['*'] } },
          },
        ];
      }

      case 'NEW_ENDPOINT': {
        const pathMatch = anomaly.details.match(/(\/[\w/-]+)/);
        const path = pathMatch ? pathMatch[1] : '/api/*';
        return [{ to: { operation: { paths: [path], methods: ['GET', 'POST'] } } }];
      }

      case 'HIGH_ERROR_RATE':
      case 'UNAUTHORIZED_ACCESS':
      default:
        return [{ to: { operation: { methods: ['GET', 'POST', 'PUT', 'DELETE'] } } }];
    }
  }
}
