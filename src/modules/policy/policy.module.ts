import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PolicyService } from './policy.service';
import { PolicyController } from './policy.controller';
import { K8sModule } from '../k8s/k8s.module';
import { PolicyDraft } from '../database/entities/policy-draft.entity';
import { PolicyHistory } from '../database/entities/policy-history.entity';
import { Anomaly } from '../database/entities/anomaly.entity';

/**
 * Policy lifecycle module.
 *
 * Binds the draft/approve/reject controller and the service that owns the
 * full workflow — draft persistence, history, YAML generation, and
 * cluster application via `K8sModule`. Needs the `Anomaly` repository
 * because drafts are frequently auto-generated from anomalies.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([PolicyDraft, PolicyHistory, Anomaly]),
    K8sModule,
  ],
  controllers: [PolicyController],
  providers: [PolicyService],
  exports: [PolicyService],
})
export class PolicyModule {}
