export default () => ({
  // Server
  port: parseInt(process.env.PORT, 10) || 3001,
  nodeEnv: process.env.NODE_ENV || 'development',

  // JWT
  jwt: {
    secret:
      process.env.JWT_SECRET ||
      'zentrion-orchestrator-secret-key-change-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
  },

  // Database (PostgreSQL)
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    username: process.env.DB_USER || 'zentrion',
    password: process.env.DB_PASSWORD || 'zentrion',
    database: process.env.DB_NAME || 'zentrion',
    logging: process.env.DB_LOGGING === 'true',
    ssl: process.env.DB_SSL === 'true',
  },

  // Kubernetes
  kubernetes: {
    inCluster: process.env.K8S_IN_CLUSTER === 'true',
    watchNamespaces: process.env.K8S_WATCH_NAMESPACES || 'all', // 'all' or comma-separated list
  },

  // Istio
  istio: {
    namespace: process.env.ISTIO_NAMESPACE || 'istio-system',
    telemetryEnabled: process.env.ISTIO_TELEMETRY_ENABLED !== 'false',
  },

  // Anomaly Detection
  anomaly: {
    detectionIntervalMs:
      parseInt(process.env.ANOMALY_DETECTION_INTERVAL_MS, 10) || 5000,
    enabled: process.env.ANOMALY_DETECTION_ENABLED !== 'false',
    suspiciousThreshold:
      parseInt(process.env.ANOMALY_SUSPICIOUS_THRESHOLD, 10) || 3,
  },

  // Policy
  policy: {
    autoGenerate: process.env.POLICY_AUTO_GENERATE !== 'false',
    applyEnabled: process.env.POLICY_APPLY_ENABLED !== 'false',
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info', // 'debug' | 'info' | 'warn' | 'error'
    format: process.env.LOG_FORMAT || 'json', // 'json' | 'text'
  },
});
