import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnomalyService } from './anomaly.service';
import { AnomalyController } from './anomaly.controller';
import { Anomaly } from '../database/entities/anomaly.entity';
import { TelemetryLog } from '../database/entities/telemetry-log.entity';

/**
 * Anomaly detection module.
 *
 * Hosts the rule-based detection loop that scans recent `TelemetryLog` rows
 * and persists findings to the `anomalies` table. Exports `AnomalyService`
 * so `PolicyModule` can react to anomalies by auto-generating policy
 * drafts.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Anomaly, TelemetryLog])],
  controllers: [AnomalyController],
  providers: [AnomalyService],
  exports: [AnomalyService],
})
export class AnomalyModule {}
