import { Module } from '@nestjs/common';
import { IstioService } from './istio.service';
import { K8sModule } from '../k8s/k8s.module';
import { EventEmitterModule } from '@nestjs/event-emitter';

@Module({
  imports: [K8sModule, EventEmitterModule.forRoot()],
  providers: [IstioService],
  exports: [IstioService],
})
export class IstioModule {}
