import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PolicyService } from './policy.service';
import { PolicyController } from './policy.controller';
import { K8sModule } from '../k8s/k8s.module';
import { PolicyDraft } from '../database/entities/policy-draft.entity';
import { PolicyHistory } from '../database/entities/policy-history.entity';
import { Anomaly } from '../database/entities/anomaly.entity';

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
