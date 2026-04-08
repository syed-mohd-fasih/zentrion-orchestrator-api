import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TelemetryService } from './telemetry.service';
import { TelemetryController } from './telemetry.controller';
import { TelemetryGateway } from './telemetry.gateway';
import { TelemetryLog } from '../database/entities/telemetry-log.entity';
import { Service } from '../database/entities/service.entity';

@Module({
  imports: [TypeOrmModule.forFeature([TelemetryLog, Service])],
  controllers: [TelemetryController],
  providers: [TelemetryService, TelemetryGateway],
  exports: [TelemetryService],
})
export class TelemetryModule {}
