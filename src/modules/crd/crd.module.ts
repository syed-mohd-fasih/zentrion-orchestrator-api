import { Module } from '@nestjs/common';
import { CrdService } from './crd.service';
import { K8sModule } from '../k8s/k8s.module';

/**
 * Zentrion CRD module.
 *
 * Wraps access to the three custom resources the orchestrator owns —
 * `SecurityProfile`, `AnomalyRecord`, and `PolicyHistory` (all under the
 * `zentrion.io/v1alpha1` group). Depends on `K8sModule` for the shared
 * custom-objects API client.
 */
@Module({
  imports: [K8sModule],
  providers: [CrdService],
  exports: [CrdService],
})
export class CrdModule {}
