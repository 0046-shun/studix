// 本番環境用設定ファイル
// このファイルは本番環境でのみ使用し、Gitにはコミットしないでください

module.exports = {
  // Server Configuration
  server: {
    port: process.env.PORT || 3000,
    nodeEnv: 'production',
    host: process.env.HOST || '0.0.0.0'
  },

  // JWT Configuration
  jwt: {
    secret: process.env.JWT_SECRET, // 本番環境では必ず環境変数から取得
    accessTokenExpiry: '15m',
    refreshTokenExpiry: '7d'
  },

  // Google Sheets Configuration
  googleSheets: {
    sheetIdOrders: process.env.SHEET_ID_ORDERS,
    sheetIdRequests: process.env.SHEET_ID_REQUESTS,
    credentialsPath: process.env.GOOGLE_CREDENTIALS_PATH
  },

  // Logging Configuration
  logging: {
    level: process.env.LOG_LEVEL || 'warn',
    logDir: process.env.LOG_DIR || '/var/log/studix',
    auditLog: {
      maxSize: parseInt(process.env.AUDIT_LOG_MAX_SIZE) || 50 * 1024 * 1024, // 50MB
      maxFiles: parseInt(process.env.AUDIT_LOG_MAX_FILES) || 10
    }
  },

  // Rate Limiting (本番環境では厳格に)
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60 * 1000, // 1 minute
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 30, // 本番では30 req/min
    adminMaxRequests: parseInt(process.env.ADMIN_RATE_LIMIT_MAX_REQUESTS) || 15
  },

  // Circuit Breaker Configuration
  circuitBreaker: {
    failureThreshold: parseInt(process.env.CIRCUIT_BREAKER_FAILURE_THRESHOLD) || 3, // 本番では3回
    recoveryTimeoutMs: parseInt(process.env.CIRCUIT_BREAKER_RECOVERY_TIMEOUT_MS) || 120000 // 2分
  },

  // Security Configuration
  security: {
    corsOrigin: process.env.CORS_ORIGIN || 'https://yourdomain.com', // 本番ドメイン
    sessionSecret: process.env.SESSION_SECRET,
    helmet: {
      enabled: true,
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'"]
        }
      }
    }
  },

  // Database Configuration (将来の拡張用)
  database: {
    url: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production'
  },

  // Monitoring Configuration
  monitoring: {
    healthCheck: {
      enabled: true,
      interval: 30000, // 30秒
      timeout: 5000    // 5秒
    },
    metrics: {
      enabled: true,
      port: process.env.METRICS_PORT || 9090
    }
  },

  // Backup Configuration
  backup: {
    enabled: true,
    schedule: '0 2 * * *', // 毎日午前2時
    retention: {
      days: 30,
      maxBackups: 10
    },
    storage: {
      type: 'local', // または 's3', 'gcs'
      path: process.env.BACKUP_PATH || '/var/backups/studix'
    }
  }
};
