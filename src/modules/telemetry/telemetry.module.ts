import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TelemetryService } from './telemetry.service';
import { TelemetryController } from './telemetry.controller';
import { TelemetryGateway } from './telemetry.gateway';
import { TelemetryLog } from '../database/entities/telemetry-log.entity';
import { Service } from '../database/entities/service.entity';

/**
 * Telemetry module.
 *
 * Binds the REST controller, the Socket.IO gateway, and the service that
 * persists Envoy access logs to `telemetry_logs`. Re-exports
 * `TelemetryService` because the anomaly engine consumes the same data.
 */
@Module({
  imports: [TypeOrmModule.forFeature([TelemetryLog, Service])],
  controllers: [TelemetryController],
  providers: [TelemetryService, TelemetryGateway],
  exports: [TelemetryService],
})
export class TelemetryModule {}
