# Zentrion Orchestrator API

The brain and central authority of the Zentrion platform - a control-plane microservice that watches the cluster, analyzes mesh telemetry, detects anomalies, and manages security policies for Istio service mesh.

## 🏗️ Architecture Overview

```
Synthetic Telemetry Generator → Anomaly Detector → Policy Generator → Dashboard Review → Istio Apply (Mock) → Audit History
```

## 📦 Prerequisites

- Node.js 18+
- pnpm (or npm/yarn)
- NestJS CLI (optional): `npm i -g @nestjs/cli`

## 🚀 Installation

1. **Install dependencies:**

```bash
pnpm install
# or
npm install
```

Required packages (add to your package.json):

```json
{
  "dependencies": {
    "@nestjs/common": "^10.0.0",
    "@nestjs/core": "^10.0.0",
    "@nestjs/platform-express": "^10.0.0",
    "@nestjs/platform-socket.io": "^10.0.0",
    "@nestjs/websockets": "^10.0.0",
    "@nestjs/jwt": "^10.0.0",
    "@nestjs/passport": "^10.0.0",
    "@nestjs/config": "^3.0.0",
    "passport": "^0.6.0",
    "passport-jwt": "^4.0.1",
    "socket.io": "^4.6.0",
    "uuid": "^9.0.0",
    "js-yaml": "^4.1.0",
    "class-validator": "^0.14.0",
    "class-transformer": "^0.5.1",
    "reflect-metadata": "^0.1.13",
    "rxjs": "^7.8.0"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.0.0",
    "@nestjs/schematics": "^10.0.0",
    "@types/node": "^20.0.0",
    "@types/uuid": "^9.0.0",
    "@types/js-yaml": "^4.0.5",
    "@types/passport-jwt": "^3.0.8",
    "typescript": "^5.0.0"
  }
}
```

2. **Environment setup (optional):**

Create `.env` file:

```bash
PORT=3001
JWT_SECRET=your-super-secret-key-change-in-production
JWT_EXPIRES_IN=24h
TELEMETRY_INTERVAL=2000
TELEMETRY_BURST=5
ANOMALY_INTERVAL=5000
POLICY_AUTO_GENERATE=true
```

## 🎯 Running the Application

```bash
# Development mode
pnpm start:dev

# Production mode
pnpm build
pnpm start:prod
```

The API will start on: **http://localhost:3001**

WebSocket endpoint: **ws://localhost:3001**

## 👥 Default Users

Three users are pre-seeded:

| Username | Password   | Role    | Capabilities                         |
| -------- | ---------- | ------- | ------------------------------------ |
| admin    | admin123   | ADMIN   | Full access, approve/reject policies |
| analyst  | analyst123 | ANALYST | Create drafts, view data             |
| viewer   | viewer123  | VIEWER  | Read-only access                     |

## 📡 API Endpoints

### Authentication

```bash
# Login
POST /auth/login
Content-Type: application/json
{
  "username": "admin",
  "password": "admin123"
}
# Returns: { "accessToken": "jwt-token", "user": {...} }

# Get current user
GET /auth/me
Authorization: Bearer <token>

# Logout
POST /auth/logout
Authorization: Bearer <token>
```

### Health Check

```bash
GET /health
# Returns: { "status": "ok", "timestamp": "...", "service": "orchestrator-api" }
```

### Telemetry

```bash
# Get live telemetry logs
GET /telemetry/live?limit=100&service=payment-service
Authorization: Bearer <token>

# Get all services
GET /telemetry/services
Authorization: Bearer <token>

# Get specific service
GET /telemetry/services?name=auth-service
Authorization: Bearer <token>
```

### Anomalies

```bash
# Get all anomalies
GET /anomalies?limit=50
Authorization: Bearer <token>

# Get specific anomaly
GET /anomalies/:id
Authorization: Bearer <token>

# Get anomalies by service
GET /anomalies/service/payment-service
Authorization: Bearer <token>
```

### Policies

```bash
# Get active policies
GET /policies/active
Authorization: Bearer <token>

# Get all drafts
GET /policies/drafts
Authorization: Bearer <token>

# Get pending drafts
GET /policies/drafts/pending
Authorization: Bearer <token>

# Get specific draft
GET /policies/drafts/:id
Authorization: Bearer <token>

# Create policy draft (ADMIN/ANALYST only)
POST /policies/drafts
Authorization: Bearer <token>
Content-Type: application/json
{
  "service": "payment-service",
  "namespace": "default",
  "rules": [
    {
      "from": {
        "source": {
          "ipBlocks": ["192.0.2.1"]
        }
      }
    }
  ],
  "reason": "Block suspicious IP"
}

# Generate policy from anomaly (ADMIN/ANALYST only)
POST /policies/drafts/from-anomaly
Authorization: Bearer <token>
Content-Type: application/json
{
  "anomalyId": "anomaly-uuid-here"
}

# Approve policy draft (ADMIN only)
POST /policies/drafts/:id/approve
Authorization: Bearer <token>
Content-Type: application/json
{
  "notes": "Approved after review"
}

# Reject policy draft (ADMIN/ANALYST only)
POST /policies/drafts/:id/reject
Authorization: Bearer <token>
Content-Type: application/json
{
  "reason": "False positive"
}

# Get policy history
GET /policies/history
Authorization: Bearer <token>

# Get history for specific policy
GET /policies/history/:policyId
Authorization: Bearer <token>
```

## 🔌 WebSocket Events

Connect using Socket.IO client:

```javascript
import io from 'socket.io-client';

const socket = io('http://localhost:3001', {
  transports: ['websocket'],
});

// Listen for telemetry logs
socket.on('telemetry.log', (log) => {
  console.log('New log:', log);
});

// Listen for service updates
socket.on('service.update', (service) => {
  console.log('Service updated:', service);
});

// Listen for anomalies
socket.on('anomaly.created', (anomaly) => {
  console.log('Anomaly detected:', anomaly);
});

// Listen for policy drafts
socket.on('policy.draft', (draft) => {
  console.log('Policy draft created:', draft);
});

// Listen for applied policies
socket.on('policy.applied', (policy) => {
  console.log('Policy applied:', policy);
});
```

## 📊 Data Flow

1. **Telemetry Generation**: Synthetic access logs generated every 2 seconds (configurable)
2. **Anomaly Detection**: Rule-based detection runs every 5 seconds (configurable)
3. **Policy Suggestion**: Anomalies automatically generate policy drafts
4. **Human Review**: Analyst/Admin reviews drafts via dashboard
5. **Policy Apply**: Admin approves → policy applied to mock K8s cluster
6. **Audit Trail**: All actions logged in policy history

## 🎨 Services & Dependencies

The system simulates 7 microservices with realistic dependencies:

```
frontend → api-gateway → auth-service
                       → payment-service → billing-service
                       → inventory-service → notification-service
```

## 🔍 Anomaly Detection Rules

8 built-in detection rules:

1. **UNUSUAL_SOURCE**: Detects requests from suspicious IPs
2. **UNEXPECTED_COMMUNICATION**: Catches service-to-service calls not in the known graph
3. **NEW_ENDPOINT**: Identifies access to previously unseen API paths
4. **HIGH_ERROR_RATE**: Triggers when error rate exceeds 20%
5. **TRAFFIC_SPIKE**: Detects 3x traffic increases
6. **SUSPICIOUS_PATTERN**: Catches rapid requests from same IP (possible DoS)
7. **LATENCY_ANOMALY**: Identifies 3x latency increases
8. **UNAUTHORIZED_ACCESS**: Multiple 401/403 responses

## 🧪 Testing the API

### Using cURL

```bash
# 1. Login
TOKEN=$(curl -s -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' \
  | jq -r '.accessToken')

# 2. Get services
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/telemetry/services | jq

# 3. Get anomalies
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/anomalies | jq

# 4. Get policy drafts
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/policies/drafts/pending | jq
```

### Using HTTPie

```bash
# Login
http POST :3001/auth/login username=admin password=admin123

# Get telemetry (save token from login)
http :3001/telemetry/live Authorization:"Bearer <token>"

# Create policy draft
http POST :3001/policies/drafts Authorization:"Bearer <token>" \
  service=payment-service namespace=default \
  reason="Manual security policy" \
  rules:='[{"to":{"operation":{"methods":["GET"]}}}]'
```

## 🔧 Customization

### Adjust Generation Rates

Edit `config/app.config.ts` or use environment variables:

```typescript
telemetry: {
  generationIntervalMs: 2000,  // Generate logs every 2s
  burstSize: 5,                // 5 logs per burst
}
```

### Add New Services

Edit `bootstrap/seed.ts`:

```typescript
const services: ServiceInfo[] = [
  {
    name: 'your-new-service',
    namespace: 'default',
    // ... config
  },
];
```

### Add Detection Rules

Edit `modules/anomaly/anomaly.service.ts` and add to the `rules` array:

```typescript
{
  name: 'Your Rule',
  type: 'YOUR_TYPE',
  check: (logs) => this.detectYourPattern(logs),
}
```

## 🚧 Known Limitations (MVP)

- In-memory storage (clears on restart)
- Mock Kubernetes client (no real cluster interaction)
- Hardcoded users (no user management API)
- Simple JWT auth (no refresh tokens)
- Template-based policy generation (no AI yet)

## 🔮 Future Enhancements

Ready for these upgrades:

1. **Persistent Storage**: Swap `store.ts` for Redis/PostgreSQL
2. **Real K8s Client**: Replace mock with `@kubernetes/client-node`
3. **AI Integration**: Add Qwen model for intelligent policy generation
4. **Event Broker**: Add Kafka/NATS for distributed events
5. **User Management**: Add CRUD APIs for users
6. **OAuth2**: Replace JWT with OAuth2/OIDC

## 📁 Project Structure

```
src/
├── main.ts                      # Bootstrap
├── app.module.ts                # Root module
├── health.controller.ts         # Health check
├── config/
│   └── app.config.ts            # Configuration
├── common/
│   ├── types.ts                 # Shared types
│   └── store.ts                 # In-memory store
├── modules/
│   ├── auth/                    # Authentication
│   │   ├── auth.module.ts
│   │   ├── auth.controller.ts
│   │   ├── auth.service.ts
│   │   ├── jwt.strategy.ts
│   │   ├── jwt-auth.guard.ts
│   │   └── roles.guard.ts
│   ├── telemetry/               # Telemetry generation
│   │   ├── telemetry.module.ts
│   │   ├── telemetry.service.ts
│   │   ├── telemetry.controller.ts
│   │   └── telemetry.gateway.ts
│   ├── anomaly/                 # Anomaly detection
│   │   ├── anomaly.module.ts
│   │   ├── anomaly.service.ts
│   │   └── anomaly.controller.ts
│   ├── policy/                  # Policy management
│   │   ├── policy.module.ts
│   │   ├── policy.service.ts
│   │   ├── policy.controller.ts
│   │   └── policy.dto.ts
│   ├── k8s/                     # Kubernetes mock
│   │   ├── k8s.module.ts
│   │   ├── k8s.service.ts
│   │   └── istio.builder.ts
│   └── events/                  # Event handling
│       ├── events.module.ts
│       └── events.service.ts
└── bootstrap/
    └── seed.ts                  # Initial data seeding
```

## 🐛 Troubleshooting

**Port already in use:**

```bash
# Change port in .env or:
PORT=3002 pnpm start:dev
```

**WebSocket not connecting:**

- Ensure CORS origins include your dashboard URL
- Check firewall rules
- Verify Socket.IO client version matches server

**No logs/anomalies appearing:**

- Check telemetry generator is running (logs should show "Telemetry generator started")
- Verify seed data loaded successfully
- Inspect browser console for WebSocket errors

## 📚 Next Steps

1. **Connect Dashboard**: Use these endpoints in your Next.js dashboard
2. **Add Real Cluster**: Swap K8s mock with real client when ready
3. **Integrate AI**: Connect Qwen model for intelligent policies
4. **Add Persistence**: Replace in-memory store with database
5. **Deploy**: Containerize and deploy to Kubernetes

## 📄 License

MIT

## 👨‍💻 Author

Zentrion Team - Final Year Project

---

**Questions?** Check the inline code documentation or raise an issue.

🎉 **Happy coding!**

---

---

---

<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
