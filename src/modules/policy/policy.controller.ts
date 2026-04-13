import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  Request,
  NotFoundException,
} from '@nestjs/common';
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
