/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { INestApplication, Logger } from '@nestjs/common';
import { store } from '../common/store';
import { User, ServiceInfo } from '../common/types';
import { v4 as uuidv4 } from 'uuid';
// import { TelemetryService } from '../modules/telemetry/telemetry.service';
import { AnomalyService } from '../modules/anomaly/anomaly.service';
import { PolicyService } from '../modules/policy/policy.service';
import { TelemetryGateway } from '../modules/telemetry/telemetry.gateway';

const logger = new Logger('SeedData');

// eslint-disable-next-line @typescript-eslint/require-await
export async function seedData(app: INestApplication) {
  logger.log('Seeding initial data...');

  // Seed users
  seedUsers();

  // Seed services
  seedServices();

  // Wire up event emitters
  wireEventEmitters(app);

  logger.log('✅ Seed data complete');
}

function seedUsers() {
  const users: User[] = [
    {
      id: uuidv4(),
      username: 'admin',
      password: 'admin123', // In production: bcrypt.hash()
      role: 'ADMIN',
      email: 'admin@zentrion.io',
      createdAt: new Date().toISOString(),
    },
    {
      id: uuidv4(),
      username: 'analyst',
      password: 'analyst123',
      role: 'ANALYST',
      email: 'analyst@zentrion.io',
      createdAt: new Date().toISOString(),
    },
    {
      id: uuidv4(),
      username: 'viewer',
      password: 'viewer123',
      role: 'VIEWER',
      email: 'viewer@zentrion.io',
      createdAt: new Date().toISOString(),
    },
  ];

  users.forEach((user) => {
    store.addUser(user);
    logger.log(`👤 User created: ${user.username} (${user.role})`);
  });
}

function seedServices() {
  const services: ServiceInfo[] = [
    {
      name: 'frontend',
      namespace: 'default',
      requestsPerSecond: 0,
      errorRate: 0,
      avgLatency: 0,
      lastSeen: new Date().toISOString(),
      dependencies: ['api-gateway'],
      labels: {
        app: 'frontend',
        version: 'v1',
        tier: 'frontend',
      },
    },
    {
      name: 'api-gateway',
      namespace: 'default',
      requestsPerSecond: 0,
      errorRate: 0,
      avgLatency: 0,
      lastSeen: new Date().toISOString(),
      dependencies: ['auth-service', 'payment-service', 'inventory-service'],
      labels: {
        app: 'api-gateway',
        version: 'v1',
        tier: 'gateway',
      },
    },
    {
      name: 'auth-service',
      namespace: 'default',
      requestsPerSecond: 0,
      errorRate: 0,
      avgLatency: 0,
      lastSeen: new Date().toISOString(),
      dependencies: [],
      labels: {
        app: 'auth-service',
        version: 'v1',
        tier: 'backend',
      },
    },
    {
      name: 'payment-service',
      namespace: 'default',
      requestsPerSecond: 0,
      errorRate: 0,
      avgLatency: 0,
      lastSeen: new Date().toISOString(),
      dependencies: ['billing-service'],
      labels: {
        app: 'payment-service',
        version: 'v1',
        tier: 'backend',
      },
    },
    {
      name: 'billing-service',
      namespace: 'default',
      requestsPerSecond: 0,
      errorRate: 0,
      avgLatency: 0,
      lastSeen: new Date().toISOString(),
      dependencies: [],
      labels: {
        app: 'billing-service',
        version: 'v1',
        tier: 'backend',
      },
    },
    {
      name: 'inventory-service',
      namespace: 'default',
      requestsPerSecond: 0,
      errorRate: 0,
      avgLatency: 0,
      lastSeen: new Date().toISOString(),
      dependencies: ['notification-service'],
      labels: {
        app: 'inventory-service',
        version: 'v1',
        tier: 'backend',
      },
    },
    {
      name: 'notification-service',
      namespace: 'default',
      requestsPerSecond: 0,
      errorRate: 0,
      avgLatency: 0,
      lastSeen: new Date().toISOString(),
      dependencies: [],
      labels: {
        app: 'notification-service',
        version: 'v1',
        tier: 'backend',
      },
    },
  ];

  services.forEach((service) => {
    store.setService(service);
    logger.log(`🔧 Service registered: ${service.name}`);
  });
}

function wireEventEmitters(app: INestApplication) {
  // Get service instances
  const telemetryGateway = app.get(TelemetryGateway);
  const anomalyService = app.get(AnomalyService);
  const policyService = app.get(PolicyService);

  // Wire anomaly service to emit through gateway
  anomalyService.setEventEmitter((event: string, data: any) => {
    if (event === 'anomaly.created') {
      telemetryGateway.emitAnomaly(data);
    }
  });

  // Wire policy service to emit through gateway
  policyService.setEventEmitter((event: string, data: any) => {
    if (event === 'policy.draft') {
      telemetryGateway.emitPolicyDraft(data);
    } else if (event === 'policy.applied') {
      telemetryGateway.emitPolicyApplied(data);
    }
  });

  logger.log('🔌 Event emitters wired');
}
