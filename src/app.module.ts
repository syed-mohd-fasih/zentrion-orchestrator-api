/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './modules/auth/auth.module';
import { TelemetryModule } from './modules/telemetry/telemetry.module';
import { AnomalyModule } from './modules/anomaly/anomaly.module';
import { PolicyModule } from './modules/policy/policy.module';
import { K8sModule } from './modules/k8s/k8s.module';
import { EventsModule } from './modules/events/events.module';
import { HealthController } from './health.controller';
import appConfig from './config/app.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig],
    }),
    AuthModule,
    TelemetryModule,
    AnomalyModule,
    PolicyModule,
    K8sModule,
    EventsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
