// 設定ファイルの例
// このファイルを config.js にコピーして、実際の値を設定してください

module.exports = {
  // Server Configuration
  server: {
    port: process.env.PORT || 3000,
    nodeEnv: process.env.NODE_ENV || 'development'
  },

  // JWT Configuration
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret-key-change-in-production',
    accessTokenExpiry: '15m',
    refreshTokenExpiry: '7d'
  },

  // Google Sheets Configuration
  googleSheets: {
    sheetIdOrders: process.env.SHEET_ID_ORDERS || 'your-orders-sheet-id',
    sheetIdRequests: process.env.SHEET_ID_REQUESTS || 'your-requests-sheet-id',
    credentialsPath: process.env.GOOGLE_CREDENTIALS_PATH || 'path/to/credentials.json'
  },

  // Logging Configuration
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    logDir: process.env.LOG_DIR || 'logs',
    auditLog: {
      maxSize: parseInt(process.env.AUDIT_LOG_MAX_SIZE) || 10 * 1024 * 1024, // 10MB
      maxFiles: parseInt(process.env.AUDIT_LOG_MAX_FILES) || 5
    }
  },

  // Rate Limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60 * 1000, // 1 minute
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 60,
    adminMaxRequests: parseInt(process.env.ADMIN_RATE_LIMIT_MAX_REQUESTS) || 30
  },

  // Circuit Breaker Configuration
  circuitBreaker: {
    failureThreshold: parseInt(process.env.CIRCUIT_BREAKER_FAILURE_THRESHOLD) || 5,
    recoveryTimeoutMs: parseInt(process.env.CIRCUIT_BREAKER_RECOVERY_TIMEOUT_MS) || 60000
  },

  // Security Configuration
  security: {
    corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:8080',
    sessionSecret: process.env.SESSION_SECRET || 'your-session-secret-here'
  }
};
