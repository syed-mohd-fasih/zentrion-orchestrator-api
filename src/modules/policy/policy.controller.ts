import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
  NotFoundException,
  Sse,
  MessageEvent,
} from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { PolicyService } from './policy.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/roles.guard';
import {
  CreatePolicyDraftDto,
  ApprovePolicyDto,
  RejectPolicyDto,
  GeneratePolicyFromAnomalyDto,
} from './policy.dto';

/**
 * Policy lifecycle HTTP API (`/policies`).
 *
 * Routes are split by required role:
 *  - `VIEWER`           — read-only list/detail routes.
 *  - `ANALYST`+`ADMIN`  — create and reject drafts.
 *  - `ADMIN`            — approve drafts (which applies them to the cluster).
 *
 * Approval is the only action that actually mutates cluster state; every
 * state change is mirrored into `PolicyHistory` for auditing.
 */
@Controller('policies')
@UseGuards(JwtAuthGuard)
export class PolicyController {
  constructor(private policyService: PolicyService) {}

  /** `GET /policies/compliance` — LLM-generated compliance score (cached 5 min). */
  @Get('compliance')
  async getComplianceScore() {
    const result = await this.policyService.getComplianceScore();
    return { ...result, timestamp: new Date().toISOString() };
  }

  /** `GET /policies/active` — list policies currently applied in the cluster. */
  @Get('active')
  async getActivePolicies() {
    return {
      policies: await this.policyService.getActivePolicies(),
      timestamp: new Date().toISOString(),
    };
  }

  /** `GET /policies/drafts/pending` — drafts still awaiting human review. */
  @Get('drafts/pending')
  async getPendingDrafts() {
    return {
      drafts: await this.policyService.getPendingDrafts(),
      timestamp: new Date().toISOString(),
    };
  }

  /** `GET /policies/drafts` — every draft across all lifecycle states. */
  @Get('drafts')
  async getAllDrafts() {
    return {
      drafts: await this.policyService.getAllDrafts(),
      timestamp: new Date().toISOString(),
    };
  }

  /** `GET /policies/history` — audit trail across every policy. */
  @Get('history')
  async getPolicyHistory() {
    return {
      history: await this.policyService.getHistory(),
      timestamp: new Date().toISOString(),
    };
  }

  /** `GET /policies/history/:policyId` — audit trail for a single policy. */
  @Get('history/:policyId')
  async getPolicyHistoryById(@Param('policyId') policyId: string) {
    return {
      history: await this.policyService.getHistory(policyId),
      policyId,
      timestamp: new Date().toISOString(),
    };
  }

  /** `GET /policies/drafts/:id/chat` — return the persisted chat history for a draft. */
  @Get('drafts/:id/chat')
  async getChat(@Param('id') id: string) {
    return {
      messages: await this.policyService.getChatHistory(id),
      timestamp: new Date().toISOString(),
    };
  }

  /** `POST /policies/drafts/:id/chat` — stream a chat reply via SSE. */
  @Post('drafts/:id/chat')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ANALYST')
  @Sse()
  streamChat(
    @Param('id') id: string,
    @Body() body: { message: string },
  ): Observable<MessageEvent> {
    const subject = new Subject<MessageEvent>();
    const message = (body?.message ?? '').toString().trim();
    if (!message) {
      setImmediate(() => {
        subject.next({ data: { error: 'message is required' } });
        subject.complete();
      });
      return subject.asObservable();
    }

    this.policyService
      .chatWithDraft(
        id,
        message,
        (token) => subject.next({ data: { token } }),
        () => {
          subject.next({ data: { done: true } });
          subject.complete();
        },
        (err) => {
          subject.next({ data: { error: err.message } });
          subject.complete();
        },
      )
      .catch((err: Error) => {
        subject.next({ data: { error: err.message } });
        subject.complete();
      });

    return subject.asObservable();
  }

  /** `GET /policies/drafts/:id/explain` — fetch the LLM explanation for a draft, generating it on-demand when missing. */
  @Get('drafts/:id/explain')
  async getExplanation(@Param('id') id: string) {
    const explanation = await this.policyService.getExplanation(id);
    if (!explanation) {
      throw new NotFoundException(
        `No LLM explanation available for draft ${id} — the local model may be offline or still loading.`,
      );
    }
    return { explanation, timestamp: new Date().toISOString() };
  }

  /** `POST /policies/drafts/:id/simulate` — run sandbox simulation against historical traffic. */
  @Post('drafts/:id/simulate')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ANALYST')
  async simulateDraft(
    @Param('id') id: string,
    @Query('windowHours') windowHours?: string,
  ) {
    const wh = windowHours ? parseInt(windowHours, 10) : undefined;
    const result = await this.policyService.simulateDraft(id, wh);
    return { result, timestamp: new Date().toISOString() };
  }

  /**
   * `GET /policies/drafts/:id` — fetch a single draft.
   * @throws `NotFoundException` when the id doesn't match any draft.
   */
  @Get('drafts/:id')
  async getDraft(@Param('id') id: string) {
    const draft = await this.policyService.getDraft(id);
    if (!draft) {
      throw new NotFoundException(`Policy draft ${id} not found`);
    }
    return {
      draft,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * `POST /policies/drafts` — manually create a new draft.
   * Restricted to ADMIN + ANALYST.
   */
  @Post('drafts')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ANALYST')
  async createDraft(@Body() dto: CreatePolicyDraftDto, @Request() req) {
    const draft = await this.policyService.createDraft({
      ...dto,
      userId: req.user.id as string,
    });
    return {
      draft,
      message: 'Policy draft created successfully',
    };
  }

  /**
   * `POST /policies/drafts/from-anomaly` — auto-generate a draft in
   * response to a specific anomaly id. Restricted to ADMIN + ANALYST.
   */
  @Post('drafts/from-anomaly')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ANALYST')
  async generateFromAnomaly(
    @Body() dto: GeneratePolicyFromAnomalyDto,
    @Request() req,
  ) {
    const draft = await this.policyService.generatePolicyFromAnomaly(
      dto.anomalyId,
      req.user.id as string,
    );
    return {
      draft,
      message: 'Policy draft generated from anomaly',
    };
  }

  /**
   * `POST /policies/drafts/:id/approve` — approve and apply a draft.
   * Restricted to ADMIN because this is the only route that mutates the
   * cluster's live security posture.
   */
  @Post('drafts/:id/approve')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async approveDraft(
    @Param('id') id: string,
    @Body() _dto: ApprovePolicyDto,
    @Request() req,
  ) {
    const draft = await this.policyService.approveDraft(id, req.user.id as string);
    return {
      draft,
      message: 'Policy approved and applied successfully',
    };
  }

  /**
   * `POST /policies/drafts/:id/reject` — reject a draft with a reason.
   * Restricted to ADMIN + ANALYST.
   */
  @Post('drafts/:id/reject')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ANALYST')
  async rejectDraft(
    @Param('id') id: string,
    @Body() dto: RejectPolicyDto,
    @Request() req,
  ) {
    const draft = await this.policyService.rejectDraft(id, req.user.id as string, dto.reason);
    return {
      draft,
      message: 'Policy rejected',
    };
  }
}
