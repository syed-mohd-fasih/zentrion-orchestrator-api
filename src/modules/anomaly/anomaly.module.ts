import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnomalyService } from './anomaly.service';
import { AnomalyController } from './anomaly.controller';
import { AiDetectionService } from './ai-detection.service';
import { Anomaly } from '../database/entities/anomaly.entity';
import { TelemetryLog } from '../database/entities/telemetry-log.entity';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [TypeOrmModule.forFeature([Anomaly, TelemetryLog]), SettingsModule],
  controllers: [AnomalyController],
  providers: [AnomalyService, AiDetectionService],
  exports: [AnomalyService, AiDetectionService],
})
export class AnomalyModule {}
