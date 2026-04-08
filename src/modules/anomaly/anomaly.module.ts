import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnomalyService } from './anomaly.service';
import { AnomalyController } from './anomaly.controller';
import { Anomaly } from '../database/entities/anomaly.entity';
import { TelemetryLog } from '../database/entities/telemetry-log.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Anomaly, TelemetryLog])],
  controllers: [AnomalyController],
  providers: [AnomalyService],
  exports: [AnomalyService],
})
export class AnomalyModule {}
