import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServiceDiscoveryService } from './service-discovery.service';
import { Service } from '../database/entities/service.entity';
import { K8sModule } from '../k8s/k8s.module';
import { CrdModule } from '../crd/crd.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Service]),
    K8sModule,
    CrdModule,
  ],
  providers: [ServiceDiscoveryService],
  exports: [ServiceDiscoveryService],
})
export class ServiceDiscoveryModule {}
