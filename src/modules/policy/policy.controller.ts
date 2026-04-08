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

@Controller('policies')
@UseGuards(JwtAuthGuard)
export class PolicyController {
  constructor(private policyService: PolicyService) {}

  @Get('active')
  async getActivePolicies() {
    return {
      policies: await this.policyService.getActivePolicies(),
      timestamp: new Date().toISOString(),
    };
  }

  @Get('drafts/pending')
  async getPendingDrafts() {
    return {
      drafts: await this.policyService.getPendingDrafts(),
      timestamp: new Date().toISOString(),
    };
  }

  @Get('drafts')
  async getAllDrafts() {
    return {
      drafts: await this.policyService.getAllDrafts(),
      timestamp: new Date().toISOString(),
    };
  }

  @Get('history')
  async getPolicyHistory() {
    return {
      history: await this.policyService.getHistory(),
      timestamp: new Date().toISOString(),
    };
  }

  @Get('history/:policyId')
  async getPolicyHistoryById(@Param('policyId') policyId: string) {
    return {
      history: await this.policyService.getHistory(policyId),
      policyId,
      timestamp: new Date().toISOString(),
    };
  }

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
