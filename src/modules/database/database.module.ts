import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { TelemetryLog } from './entities/telemetry-log.entity';
import { Anomaly } from './entities/anomaly.entity';
import { PolicyDraft } from './entities/policy-draft.entity';
import { PolicyHistory } from './entities/policy-history.entity';
import { Service } from './entities/service.entity';
import { User } from './entities/user.entity';

/**
 * Database module.
 *
 * Establishes the PostgreSQL connection via TypeORM and registers every
 * domain entity. The connection string is assembled from `ConfigService`
 * (which in turn reads `DB_*` env vars). Two important knobs:
 *
 *  - `synchronize` is driven by the `DB_SYNC` env var. It auto-creates tables
 *    on boot when `"true"` — set this only for the very first deployment and
 *    flip it back to `"false"` once the schema is in place, because
 *    `synchronize` can drop/alter columns when entities change.
 *  - Re-exports `TypeOrmModule` so feature modules can call
 *    `TypeOrmModule.forFeature([...])` without re-importing the root config.
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('DB_HOST', 'localhost'),
        port: config.get('DB_PORT', 5432),
        username: config.get('DB_USER', 'zentrion'),
        password: config.get('DB_PASSWORD', 'zentrion'),
        database: config.get('DB_NAME', 'zentrion'),
        entities: [
          TelemetryLog,
          Anomaly,
          PolicyDraft,
          PolicyHistory,
          Service,
          User,
        ],
        synchronize: config.get('DB_SYNC', 'false') === 'true',
        logging: config.get('DB_LOGGING', false),
        ssl: config.get('DB_SSL', false),
      }),
    }),
    TypeOrmModule.forFeature([
      TelemetryLog,
      Anomaly,
      PolicyDraft,
      PolicyHistory,
      Service,
      User,
    ]),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
