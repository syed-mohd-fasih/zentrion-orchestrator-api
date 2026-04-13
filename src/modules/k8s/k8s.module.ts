import { Module } from '@nestjs/common';
import { K8sService } from './k8s.service';

/**
 * Kubernetes integration module.
 *
 * Single provider (`K8sService`) that wraps `@kubernetes/client-node` and
 * exposes it to any feature module that needs to talk to the cluster —
 * notably `IstioModule`, `CrdModule`, `ServiceDiscoveryModule`, and
 * `PolicyModule` (which applies generated manifests).
 */
@Module({
  providers: [K8sService],
  exports: [K8sService],
})
export class K8sModule {}
