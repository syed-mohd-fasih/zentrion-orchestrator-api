import { Module } from '@nestjs/common';
import { IstioService } from './istio.service';
import { K8sModule } from '../k8s/k8s.module';
import { EventEmitterModule } from '@nestjs/event-emitter';

/**
 * Istio integration module.
 *
 * Hosts the `IstioService` that tails Envoy sidecar access logs via the
 * K8s API and re-emits each parsed line on the internal event bus
 * (`telemetry.log`). Depends on `K8sModule` for cluster access and on
 * `EventEmitterModule` to publish telemetry downstream to the telemetry
 * service.
 */
@Module({
  imports: [K8sModule, EventEmitterModule.forRoot()],
  providers: [IstioService],
  exports: [IstioService],
})
export class IstioModule {}
