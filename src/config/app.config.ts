/**
 * Application configuration factory.
 *
 * Consumed by `@nestjs/config` via `ConfigModule.forRoot({ load: [appConfig] })`.
 * Every value is read from `process.env` with a sensible default so the app
 * can boot in local development without a populated `.env`. Types are kept
 * primitive (numbers via `parseInt`, booleans via equality checks on strings)
 * because env vars are always strings.
 *
 * @returns Nested config object grouped by concern (server, jwt, database, ...).
 */
export default () => ({
  // --- HTTP server ---------------------------------------------------------
  port: parseInt(process.env.PORT ?? '', 10) || 3001,
  nodeEnv: process.env.NODE_ENV || 'development',

  // --- JWT authentication --------------------------------------------------
  // NOTE: the default secret is for local dev ONLY; production deployments
  // must inject a strong `JWT_SECRET` via Kubernetes Secret.
  jwt: {
    secret:
      process.env.JWT_SECRET ||
      'zentrion-orchestrator-secret-key-change-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
  },

  // --- PostgreSQL connection ----------------------------------------------
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT ?? '', 10) || 5432,
    username: process.env.DB_USER || 'zentrion',
    password: process.env.DB_PASSWORD || 'zentrion',
    database: process.env.DB_NAME || 'zentrion',
    logging: process.env.DB_LOGGING === 'true',
    ssl: process.env.DB_SSL === 'true',
  },

  // --- Kubernetes client ---------------------------------------------------
  // `inCluster=true` uses the in-cluster service account (pod deployment);
  // `false` falls back to local kubeconfig (developer workstation).
  kubernetes: {
    inCluster: process.env.K8S_IN_CLUSTER === 'true',
    watchNamespaces: process.env.K8S_WATCH_NAMESPACES || 'all', // 'all' | csv list
  },

  // --- Istio integration ---------------------------------------------------
  istio: {
    namespace: process.env.ISTIO_NAMESPACE || 'istio-system',
    telemetryEnabled: process.env.ISTIO_TELEMETRY_ENABLED !== 'false',
  },

  // --- Anomaly detection engine -------------------------------------------
  // `suspiciousThreshold` controls how many rule hits trigger an anomaly.
  anomaly: {
    detectionIntervalMs:
      parseInt(process.env.ANOMALY_DETECTION_INTERVAL_MS ?? '', 10) || 5000,
    enabled: process.env.ANOMALY_DETECTION_ENABLED !== 'false',
    suspiciousThreshold:
      parseInt(process.env.ANOMALY_SUSPICIOUS_THRESHOLD ?? '', 10) || 3,
  },

  // --- Policy lifecycle ----------------------------------------------------
  policy: {
    autoGenerate: process.env.POLICY_AUTO_GENERATE !== 'false',
    applyEnabled: process.env.POLICY_APPLY_ENABLED !== 'false',
  },

  // --- Logging -------------------------------------------------------------
  logging: {
    level: process.env.LOG_LEVEL || 'info', // 'debug' | 'info' | 'warn' | 'error'
    format: process.env.LOG_FORMAT || 'json', // 'json' | 'text'
  },
});
