import { Module } from '@nestjs/common';
import { CrdService } from './crd.service';
import { K8sModule } from '../k8s/k8s.module';

@Module({
  imports: [K8sModule],
  providers: [CrdService],
  exports: [CrdService],
})
export class CrdModule {}
