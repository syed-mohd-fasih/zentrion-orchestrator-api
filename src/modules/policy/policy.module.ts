import { Module } from '@nestjs/common';
import { PolicyService } from './policy.service';
import { PolicyController } from './policy.controller';
import { K8sModule } from '../k8s/k8s.module';
import { AnomalyModule } from '../anomaly/anomaly.module';
import { TelemetryModule } from '../telemetry/telemetry.module';

@Module({
  imports: [K8sModule, AnomalyModule, TelemetryModule],
  controllers: [PolicyController],
  providers: [PolicyService],
  exports: [PolicyService],
})
export class PolicyModule {}
