import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';

// Database
import { DatabaseModule } from './modules/database/database.module';

// Core modules
import { AuthModule } from './modules/auth/auth.module';
import { K8sModule } from './modules/k8s/k8s.module';
import { IstioModule } from './modules/istio/istio.module';
import { CrdModule } from './modules/crd/crd.module';
import { ServiceDiscoveryModule } from './modules/service-discovery/service-discovery.module';

// Business logic modules
import { TelemetryModule } from './modules/telemetry/telemetry.module';
import { AnomalyModule } from './modules/anomaly/anomaly.module';
import { PolicyModule } from './modules/policy/policy.module';

// Health check
import { HealthController } from './health.controller';

// Configuration
import appConfig from './config/app.config';

/**
 * Root application module.
 *
 * Wires up every feature module of the orchestrator:
 *  - `ConfigModule` — global, loads `appConfig` plus `.env.local` / `.env`.
 *  - `EventEmitterModule` — in-process pub/sub used to decouple the Istio
 *    watcher from the telemetry/anomaly pipelines.
 *  - `ScheduleModule` — cron/interval jobs (anomaly detection loop).
 *  - `DatabaseModule` — TypeORM + PostgreSQL connection and entity registration.
 *  - Infrastructure modules (`K8sModule`, `IstioModule`, `CrdModule`,
 *    `ServiceDiscoveryModule`) — integrate with the cluster.
 *  - Core domain modules (`AuthModule`, `TelemetryModule`, `AnomalyModule`,
 *    `PolicyModule`) — authentication and the detect→draft→approve→apply flow.
 *
 * The only controller registered here is `HealthController`; every other HTTP
 * route lives inside its owning feature module.
 */
@Module({
  imports: [
    // Global configuration
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig],
      envFilePath: ['.env.local', '.env'],
    }),

    // Event system (for internal communication)
    EventEmitterModule.forRoot({
      wildcard: false,
      delimiter: '.',
      newListener: false,
      removeListener: false,
      maxListeners: 10,
      verboseMemoryLeak: true,
      ignoreErrors: false,
    }),

    // Cron jobs (for periodic tasks)
    ScheduleModule.forRoot(),

    // Database (PostgreSQL + TypeORM)
    DatabaseModule,

    // Infrastructure modules
    K8sModule, // Kubernetes API client
    IstioModule, // Istio telemetry watcher
    CrdModule, // Zentrion CRD management
    ServiceDiscoveryModule, // Deployment watcher

    // Core application modules
    AuthModule, // JWT authentication
    TelemetryModule, // Telemetry processing
    AnomalyModule, // Anomaly detection
    PolicyModule, // Policy management
  ],
  controllers: [HealthController],
})
export class AppModule {}
