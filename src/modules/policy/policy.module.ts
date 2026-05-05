import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PolicyService } from './policy.service';
import { PolicyController } from './policy.controller';
import { LlmService } from './llm.service';
import { SandboxService } from './sandbox.service';
import { K8sModule } from '../k8s/k8s.module';
import { PolicyDraft } from '../database/entities/policy-draft.entity';
import { PolicyHistory } from '../database/entities/policy-history.entity';
import { Anomaly } from '../database/entities/anomaly.entity';
import { TelemetryLog } from '../database/entities/telemetry-log.entity';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([PolicyDraft, PolicyHistory, Anomaly, TelemetryLog]),
    K8sModule,
    SettingsModule,
  ],
  controllers: [PolicyController],
  providers: [PolicyService, LlmService, SandboxService],
  exports: [PolicyService, LlmService],
})
export class PolicyModule {}
