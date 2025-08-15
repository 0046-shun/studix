const fs = require('fs');
const path = require('path');

// 監査ログの設定
const AUDIT_CONFIG = {
  maxFileSize: 10 * 1024 * 1024, // 10MB
  maxFiles: 5, // 最大5ファイル
  logDir: path.join(__dirname, '..', '..', 'logs'),
  logFile: 'audit.log'
};

// 監査ログエントリの構造
async function auditLog(action, payload, result, metadata = {}) {
  const dir = AUDIT_CONFIG.logDir;
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  
  const file = path.join(dir, AUDIT_CONFIG.logFile);
  
  // ログローテーション
  await rotateLogIfNeeded(file);
  
  const entry = {
    timestamp: new Date().toISOString(),
    action,
    payload,
    result,
    metadata: {
      ...metadata,
      userAgent: metadata.userAgent || 'unknown',
      ipAddress: metadata.ipAddress || 'unknown',
      userId: metadata.userId || 'unknown',
      sessionId: metadata.sessionId || 'unknown'
    }
  };
  
  fs.appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8');
}

// ログローテーション
async function rotateLogIfNeeded(filePath) {
  try {
    const stats = fs.statSync(filePath);
    if (stats.size > AUDIT_CONFIG.maxFileSize) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFile = filePath.replace('.log', `.${timestamp}.log`);
      fs.renameSync(filePath, backupFile);
      
      // 古いログファイルを削除
      const logDir = path.dirname(filePath);
      const logFiles = fs.readdirSync(logDir)
        .filter(f => f.startsWith('audit.') && f.endsWith('.log'))
        .sort()
        .reverse();
      
      if (logFiles.length > AUDIT_CONFIG.maxFiles) {
        const filesToDelete = logFiles.slice(AUDIT_CONFIG.maxFiles);
        filesToDelete.forEach(f => {
          try {
            fs.unlinkSync(path.join(logDir, f));
          } catch (e) {
            // 削除に失敗しても続行
          }
        });
      }
    }
  } catch (e) {
    // ファイルが存在しない場合は何もしない
  }
}

// 監査ログの検索
async function searchAuditLogs(filters = {}) {
  const dir = AUDIT_CONFIG.logDir;
  const file = path.join(dir, AUDIT_CONFIG.logFile);
  
  try {
    if (!fs.existsSync(file)) {
      return { logs: [], total: 0 };
    }
    
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.trim().split('\n').filter(line => line.trim());
    
    let logs = lines.map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }).filter(log => log !== null);
    
    // フィルタリング
    if (filters.action) {
      logs = logs.filter(log => log.action === filters.action);
    }
    if (filters.userId) {
      logs = logs.filter(log => log.metadata?.userId === filters.userId);
    }
    if (filters.startDate) {
      logs = logs.filter(log => new Date(log.timestamp) >= new Date(filters.startDate));
    }
    if (filters.endDate) {
      logs = logs.filter(log => new Date(log.timestamp) <= new Date(filters.endDate));
    }
    if (filters.success !== undefined) {
      logs = logs.filter(log => log.result?.ok === filters.success);
    }
    
    // ソート（新しい順）
    logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    // ページネーション
    const page = filters.page || 1;
    const limit = Math.min(filters.limit || 100, 1000);
    const start = (page - 1) * limit;
    const paginatedLogs = logs.slice(start, start + limit);
    
    return {
      logs: paginatedLogs,
      total: logs.length,
      pagination: {
        page,
        limit,
        total: logs.length,
        totalPages: Math.ceil(logs.length / limit)
      }
    };
  } catch (e) {
    return { logs: [], total: 0, error: e.message };
  }
}

// 監査ログの統計
async function getAuditStats() {
  const dir = AUDIT_CONFIG.logDir;
  const file = path.join(dir, AUDIT_CONFIG.logFile);
  
  try {
    if (!fs.existsSync(file)) {
      return { totalLogs: 0, actions: {}, successRate: 0 };
    }
    
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.trim().split('\n').filter(line => line.trim());
    
    let totalLogs = 0;
    let successfulLogs = 0;
    const actions = {};
    
    lines.forEach(line => {
      try {
        const log = JSON.parse(line);
        totalLogs++;
        
        if (log.result?.ok) {
          successfulLogs++;
        }
        
        actions[log.action] = (actions[log.action] || 0) + 1;
      } catch {
        // パースに失敗したログは無視
      }
    });
    
    return {
      totalLogs,
      actions,
      successRate: totalLogs > 0 ? (successfulLogs / totalLogs * 100).toFixed(2) : 0
    };
  } catch (e) {
    return { totalLogs: 0, actions: {}, successRate: 0, error: e.message };
  }
}

module.exports = { 
  auditLog, 
  searchAuditLogs, 
  getAuditStats,
  AUDIT_CONFIG 
};
