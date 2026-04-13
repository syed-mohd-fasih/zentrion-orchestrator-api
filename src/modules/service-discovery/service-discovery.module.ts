import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServiceDiscoveryService } from './service-discovery.service';
import { Service } from '../database/entities/service.entity';
import { K8sModule } from '../k8s/k8s.module';
import { CrdModule } from '../crd/crd.module';

/**
 * Service-discovery module.
 *
 * Owns the deployment watcher that populates the `services` table and the
 * associated `SecurityProfile` CRDs whenever a new workload appears in the
 * cluster. Depends on `K8sModule` for the watcher, `CrdModule` for profile
 * creation, and the `Service` repository for DB persistence.
 */
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
