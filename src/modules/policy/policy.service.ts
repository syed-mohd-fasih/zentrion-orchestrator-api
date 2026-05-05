import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  Optional,
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
import { LlmService, LlmPolicyResponse } from './llm.service';
import { SandboxService, SandboxResult } from './sandbox.service';
import { SettingsService } from '../settings/settings.service';

/**
 * Policy lifecycle service.
 *
 * Orchestrates the full detect → draft → approve → apply flow:
 *  1. A draft is created (manually or auto-generated from an anomaly).
 *  2. An admin approves it; `K8sService.applyManifest` pushes the YAML.
 *  3. Every transition is recorded in `PolicyHistory` for audit.
 *
 * Approval is the single atomic boundary — if the K8s apply throws, the
 * draft stays `pending` so the operator can retry after fixing the
 * underlying cluster issue.
 */
@Injectable()
export class PolicyService {
  private readonly logger = new Logger(PolicyService.name);
  /** Optional WebSocket emitter registered by the gateway. */
  private eventEmitter: ((event: string, data: any) => void) | null = null;

  constructor(
    @InjectRepository(PolicyDraft)
    private draftRepo: Repository<PolicyDraft>,
    @InjectRepository(PolicyHistory)
    private historyRepo: Repository<PolicyHistory>,
    @InjectRepository(Anomaly)
    private anomalyRepo: Repository<Anomaly>,
    private k8sService: K8sService,
    @Optional() private llmService: LlmService,
    @Optional() private sandboxService: SandboxService,
    @Optional() private settingsService: SettingsService,
  ) {}

  /** Register the WebSocket emitter (wired up by `TelemetryGateway`). */
  setEventEmitter(emitter: (event: string, data: any) => void) {
    this.eventEmitter = emitter;
  }

  /**
   * Auto-generate a `DENY` policy draft from an anomaly.
   *
   * Resolves the anomaly from its public `anomalyId`, derives suitable
   * authorization rules from its type (see `generateRulesFromAnomaly`),
   * assembles the YAML via the builder, persists the draft, and emits a
   * `policy.draft` event for the dashboard.
   *
   * @throws `NotFoundException` if the anomaly is unknown.
   */
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

    // Fire-and-forget: generate LLM explanation asynchronously (does not block response).
    if (this.llmService) {
      this.triggerLlmExplanation(draft.draftId, anomaly).catch((err: Error) =>
        this.logger.warn(`LLM explanation failed for draft ${draft.draftId}: ${err.message}`),
      );
    }

    if (this.eventEmitter) {
      this.eventEmitter('policy.draft', draft);
    }

    this.logger.log(`Policy draft created: ${draft.draftId} for service ${draft.service}`);
    return draft;
  }

  private async triggerLlmExplanation(draftId: string, anomaly: Anomaly) {
    const draft = await this.draftRepo.findOne({ where: { draftId } });
    if (!draft || !this.llmService) return;

    const prompt = this.llmService.buildAnomalyPrompt(
      anomaly.type,
      anomaly.details,
      draft.yamlContent,
    );
    const result = await this.llmService.generate(prompt);
    if (result) {
      draft.llmExplanation = JSON.stringify(result);
      await this.draftRepo.save(draft);
      this.logger.log(`LLM explanation saved for draft ${draftId}`);
    }
  }

  async simulateDraft(draftId: string, windowHours?: number): Promise<SandboxResult> {
    if (!this.sandboxService) {
      throw new BadRequestException('Sandbox service is not available');
    }
    const draft = await this.draftRepo.findOne({ where: { draftId } });
    if (!draft) throw new NotFoundException(`Policy draft ${draftId} not found`);

    const anomaly = draft.anomalyId
      ? await this.anomalyRepo.findOne({ where: { anomalyId: draft.anomalyId } })
      : null;
    const anomalyLogIds = anomaly?.associatedLogs ?? [];

    const hours = windowHours ?? this.settingsService?.getSandboxWindowHours() ?? 24;
    return this.sandboxService.simulateDraft(draftId, hours, anomalyLogIds);
  }

  async getExplanation(draftId: string): Promise<LlmPolicyResponse | null> {
    const draft = await this.draftRepo.findOne({ where: { draftId } });
    if (!draft) throw new NotFoundException(`Policy draft ${draftId} not found`);
    if (!draft.llmExplanation) return null;
    try {
      return JSON.parse(draft.llmExplanation) as LlmPolicyResponse;
    } catch {
      return null;
    }
  }

  /**
   * Manually create a draft from a user-supplied rule set.
   *
   * Takes the same shape as the anomaly-driven path but lets operators
   * craft bespoke policies (e.g. ad-hoc zero-trust baselining) without
   * needing an anomaly to attach it to.
   */
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

  /**
   * Approve a pending draft and apply the manifest to the cluster.
   *
   * The DB write happens AFTER the cluster apply returns successfully so
   * a failed apply does not mark the draft as `applied`. Two history
   * entries are appended: `approved` (intent) and `applied` (result).
   *
   * @throws `NotFoundException` if the draft id is unknown.
   * @throws `BadRequestException` if the draft isn't in `pending` state.
   */
  async approveDraft(draftId: string, userId: string): Promise<PolicyDraft> {
    const draft = await this.draftRepo.findOne({ where: { draftId } });
    if (!draft) throw new NotFoundException(`Policy draft ${draftId} not found`);
    if (draft.status !== 'pending') {
      throw new BadRequestException(`Policy draft is already ${draft.status}`);
    }

    // Push to the cluster first — if this throws, the draft stays `pending`.
    const result = await this.k8sService.applyManifest(draft.yamlContent, userId);

    draft.status = 'applied';
    draft.approvedBy = userId;
    draft.appliedAt = new Date();
    await this.draftRepo.save(draft);

    await this.addHistory(draftId, 'approved', userId, 'Policy approved');
    await this.addHistory(draftId, 'applied', userId, `Applied to cluster: ${result.name}`);

    if (this.eventEmitter) {
      this.eventEmitter('policy.applied', draft);
    }

    this.logger.log(`Policy ${draftId} approved and applied by ${userId}`);
    return draft;
  }

  /**
   * Reject a pending draft with a required reason.
   *
   * @throws `NotFoundException` if unknown.
   * @throws `BadRequestException` if not `pending`.
   */
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

  /** Return every draft, most recently created first. */
  async getAllDrafts(): Promise<PolicyDraft[]> {
    return this.draftRepo.find({ order: { createdAt: 'DESC' } });
  }

  /** Return only drafts still awaiting review. */
  async getPendingDrafts(): Promise<PolicyDraft[]> {
    return this.draftRepo.find({ where: { status: 'pending' }, order: { createdAt: 'DESC' } });
  }

  /** Return drafts whose status is `applied` — i.e., policies live in-cluster. */
  async getActivePolicies(): Promise<PolicyDraft[]> {
    return this.draftRepo.find({ where: { status: 'applied' }, order: { appliedAt: 'DESC' } });
  }

  /** Fetch a draft by its public `draftId` UUID. */
  async getDraft(id: string): Promise<PolicyDraft | null> {
    return this.draftRepo.findOne({ where: { draftId: id } });
  }

  /**
   * Return audit-trail rows, optionally scoped to a single policy id.
   *
   * @param policyId Optional `draftId` filter.
   */
  async getHistory(policyId?: string): Promise<PolicyHistory[]> {
    if (policyId) {
      return this.historyRepo.find({ where: { policyId }, order: { timestamp: 'DESC' } });
    }
    return this.historyRepo.find({ order: { timestamp: 'DESC' } });
  }

  /**
   * Append a row to the `PolicyHistory` audit trail.
   *
   * Private because every state transition must go through the dedicated
   * methods above — direct history inserts would bypass the validation
   * those methods perform.
   */
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

  /**
   * Translate an anomaly into a minimal `AuthorizationRule` set.
   *
   * This is the "template-based policy generation" called out in CLAUDE.md
   * as an explicit FYP scope boundary — an ML model would replace this
   * method in future work. Rules are intentionally broad (`methods: ['*']`
   * for IP-based anomalies) so the generated policy is a safe starting
   * point that the analyst can then narrow before approving.
   */
  private generateRulesFromAnomaly(anomaly: Anomaly): AuthorizationRule[] {
    switch (anomaly.type) {
      case 'UNUSUAL_SOURCE':
      case 'SUSPICIOUS_PATTERN': {
        // Pull the offending IP out of the anomaly's `details` string.
        const ipMatch = anomaly.details.match(/(\d+\.\d+\.\d+\.\d+)/);
        const ip = ipMatch ? ipMatch[1] : '192.0.2.0/24';
        return [{ from: { source: { ipBlocks: [ip] } }, to: { operation: { methods: ['*'] } } }];
      }

      case 'UNEXPECTED_COMMUNICATION': {
        // Extract the offending source workload from the "A -> B" details.
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
        // Pin down the sensitive path that was hit.
        const pathMatch = anomaly.details.match(/(\/[\w/-]+)/);
        const path = pathMatch ? pathMatch[1] : '/api/*';
        return [{ to: { operation: { paths: [path], methods: ['GET', 'POST'] } } }];
      }

      case 'HIGH_ERROR_RATE':
      case 'UNAUTHORIZED_ACCESS':
      default:
        // Fallback: deny common write-ish methods; analyst narrows before approval.
        return [{ to: { operation: { methods: ['GET', 'POST', 'PUT', 'DELETE'] } } }];
    }
  }
}
