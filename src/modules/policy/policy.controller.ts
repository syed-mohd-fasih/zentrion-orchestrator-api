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
import { store } from '../../common/store';

@Controller('policies')
@UseGuards(JwtAuthGuard)
export class PolicyController {
  constructor(private policyService: PolicyService) {}

  @Get('active')
  getActivePolicies() {
    return {
      policies: this.policyService.getActivePolicies(),
      timestamp: new Date().toISOString(),
    };
  }

  @Get('drafts')
  getAllDrafts() {
    return {
      drafts: this.policyService.getAllDrafts(),
      timestamp: new Date().toISOString(),
    };
  }

  @Get('drafts/pending')
  getPendingDrafts() {
    return {
      drafts: this.policyService.getPendingDrafts(),
      timestamp: new Date().toISOString(),
    };
  }

  @Get('drafts/:id')
  getDraft(@Param('id') id: string) {
    const draft = this.policyService.getDraft(id);
    if (!draft) {
      throw new NotFoundException(`Policy draft ${id} not found`);
    }
    return {
      draft,
      timestamp: new Date().toISOString(),
    };
  }

  @Post('drafts')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ANALYST')
  createDraft(@Body() dto: CreatePolicyDraftDto, @Request() req) {
    const draft = this.policyService.createDraft({
      ...dto,
      userId: req.user.id,
    });
    return {
      draft,
      message: 'Policy draft created successfully',
    };
  }

  @Post('drafts/from-anomaly')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ANALYST')
  generateFromAnomaly(
    @Body() dto: GeneratePolicyFromAnomalyDto,
    @Request() req,
  ) {
    const anomaly = store.getAnomaly(dto.anomalyId);
    if (!anomaly) {
      throw new NotFoundException(`Anomaly ${dto.anomalyId} not found`);
    }

    const draft = this.policyService.generatePolicyFromAnomaly(
      anomaly,
      req.user.id,
    );
    return {
      draft,
      message: 'Policy draft generated from anomaly',
    };
  }

  @Post('drafts/:id/approve')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async approveDraft(
    @Param('id') id: string,
    @Body() dto: ApprovePolicyDto,
    @Request() req,
  ) {
    const draft = await this.policyService.approveDraft(id, req.user.id);
    return {
      draft,
      message: 'Policy approved and applied successfully',
    };
  }

  @Post('drafts/:id/reject')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'ANALYST')
  rejectDraft(
    @Param('id') id: string,
    @Body() dto: RejectPolicyDto,
    @Request() req,
  ) {
    const draft = this.policyService.rejectDraft(id, req.user.id, dto.reason);
    return {
      draft,
      message: 'Policy rejected',
    };
  }

  @Get('history')
  getPolicyHistory() {
    return {
      history: this.policyService.getHistory(),
      timestamp: new Date().toISOString(),
    };
  }

  @Get('history/:policyId')
  getPolicyHistoryById(@Param('policyId') policyId: string) {
    return {
      history: this.policyService.getHistory(policyId),
      policyId,
      timestamp: new Date().toISOString(),
    };
  }
}
