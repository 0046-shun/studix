const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const fs = require('fs');
const path = require('path');

const { appendOrderRow, appendRequestRow } = require('./services/googleSheetsService');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { withRetry } = require('./utils/retry');
const { auditLog, searchAuditLogs, getAuditStats } = require('./utils/audit');

const PORT = process.env.PORT || 3000;
const IS_TEST = process.env.NODE_ENV === 'test';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
if (!IS_TEST) app.use(morgan('dev'));

// -------------------------------
// Simple rate limiting
// -------------------------------
const rateBuckets = new Map();
function rateLimit({ windowMs, max, keyFn }) {
  return (req, res, next) => {
    try {
      if (IS_TEST) return next();
      const key = keyFn ? keyFn(req) : req.ip;
      const now = Date.now();
      const bucket = rateBuckets.get(key) || { count: 0, resetAt: now + windowMs };
      if (now > bucket.resetAt) {
        bucket.count = 0;
        bucket.resetAt = now + windowMs;
      }
      bucket.count += 1;
      rateBuckets.set(key, bucket);
      res.setHeader('X-RateLimit-Limit', String(max));
      res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
      res.setHeader('X-RateLimit-Reset', String(Math.floor(bucket.resetAt / 1000)));
      if (bucket.count > max) {
        return res.status(429).json({ success: false, error: { code: 'RATE_LIMITED', message: 'リクエストが多すぎます。しばらくしてから再実行してください。' } });
      }
      next();
    } catch (e) {
      next();
    }
  };
}

// Global: 60 req/min per IP（テスト時は無効）
if (!IS_TEST) app.use(rateLimit({ windowMs: 60 * 1000, max: 60 }));

// Health check
app.get('/api/v1/health', (req, res) => {
  const healthData = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: process.version,
    platform: process.platform,
    arch: process.arch
  };
  
  res.json({ success: true, data: healthData });
});

// Detailed health check
app.get('/api/v1/health/detailed', async (req, res) => {
  try {
    const healthData = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      version: process.version,
      platform: process.platform,
      arch: process.arch,
      services: {
        googleSheets: {
          status: 'ok',
          circuitBreaker: sheetsCircuitBreaker.getStatus()
        },
        auditLogs: {
          status: 'ok',
          stats: await getAuditStats()
        }
      }
    };
    
    res.json({ success: true, data: healthData });
  } catch (error) {
    res.status(500).json({
      success: false,
      data: {
        status: 'error',
        timestamp: new Date().toISOString(),
        error: error.message
      }
    });
  }
});

// POST /api/v1/orders/sheets
app.post('/api/v1/orders/sheets', async (req, res) => {
  const body = req.body || {};
  const order = body.order;
  const staff = body.staff;
  if (!order || !staff) {
    return sendErrorResponse(res, ERROR_CODES.VALIDATION_ERROR, 'order と staff は必須です', null, 400);
  }
  
  try {
    const result = await sheetsCircuitBreaker.execute(async () => {
      return await withRetry(() => appendOrderRow(order, staff), { attempts: 3, baseDelayMs: IS_TEST ? 1 : 500 });
    });
    
    await auditLog('orders.append', { order, staff }, { ok: true, result });
    res.json({ success: true, data: result || { appended: true } });
  } catch (err) {
    await auditLog('orders.append', { order, staff }, { ok: false, message: err.message });
    
    if (err.message === 'Circuit breaker is OPEN') {
      sendErrorResponse(res, ERROR_CODES.SERVICE_UNAVAILABLE, 'Google Sheets連携が一時的に利用できません。しばらくしてから再実行してください。', { circuitBreakerStatus: sheetsCircuitBreaker.getStatus() }, 503);
    } else {
      sendErrorResponse(res, ERROR_CODES.EXTERNAL_SERVICE_ERROR, 'Orders Sheet への転記に失敗しました', { details: err.message }, 502);
    }
  }
});

// POST /api/v1/requests/sheets
app.post('/api/v1/requests/sheets', async (req, res) => {
  const body = req.body || {};
  const requestText = (body.request_text || '').toString().trim();
  const staff = body.staff;
  const createdAt = body.created_at || new Date().toISOString();
  if (!requestText) {
    return sendErrorResponse(res, ERROR_CODES.VALIDATION_ERROR, 'request_text は必須です', null, 400);
  }
  if (!staff) {
    return sendErrorResponse(res, ERROR_CODES.VALIDATION_ERROR, 'staff は必須です', null, 400);
  }
  
  try {
    const result = await sheetsCircuitBreaker.execute(async () => {
      return await withRetry(() => appendRequestRow(requestText, staff, createdAt), { attempts: 3, baseDelayMs: IS_TEST ? 1 : 500 });
    });
    
    await auditLog('requests.append', { requestText, staff, createdAt }, { ok: true, result });
    res.json({ success: true, data: result || { appended: true } });
  } catch (err) {
    await auditLog('requests.append', { requestText, staff, createdAt }, { ok: false, message: err.message });
    
    if (err.message === 'Circuit breaker is OPEN') {
      sendErrorResponse(res, ERROR_CODES.SERVICE_UNAVAILABLE, 'Google Sheets連携が一時的に利用できません。しばらくしてから再実行してください。', { circuitBreakerStatus: sheetsCircuitBreaker.getStatus() }, 503);
    } else {
      sendErrorResponse(res, ERROR_CODES.EXTERNAL_SERVICE_ERROR, 'Requests Sheet への転記に失敗しました', { details: err.message }, 502);
    }
  }
});

// -------------------------------
// Task 2: 検索API（モック/ファイルベース）
// -------------------------------

// GET /api/v1/employees/search
app.get('/api/v1/employees/search', async (req, res) => {
  try {
    const kana = (req.query.name_kana || '').toString().toLowerCase();
    const district = (req.query.district_code || '').toString();
    const dept = (req.query.department_code || '').toString();
    const limit = Math.min(parseInt(req.query.limit || '20', 10) || 20, 100);

    // Prefer server-local mock (server/tantou/test-staff.json), fallback to repo root (tantou/test-staff.json)
    const candidateFiles = [
      path.join(__dirname, '..', 'tantou', 'test-staff.json'),
      path.join(__dirname, '..', '..', 'tantou', 'test-staff.json'),
    ];
    let list = [];
    let loaded = false;
    for (const filePath of candidateFiles) {
      try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw || '{}');
        // データ構造を確認して適切に処理
        if (parsed.staffList && Array.isArray(parsed.staffList)) {
          list = parsed.staffList;
        } else if (Array.isArray(parsed)) {
          list = parsed;
        } else {
          list = [];
        }
        loaded = true;
        break;
      } catch {
        // try next
      }
    }
    if (!loaded) list = [];

    // 検索フィルタリング
    const filtered = list.filter((e) => {
      const okKana = kana ? (e.search_kana || e.katakanaNam || '').toLowerCase().includes(kana) : true;
      const okDistrict = district ? String(e.district_code || e.districtNo || '') === district : true;
      const okDept = dept ? String(e.department_code || e.departmentNo || '') === dept : true;
      return okKana && okDistrict && okDept;
    }).slice(0, limit);

    // レスポンス形式を統一
    const normalizedEmployees = filtered.map(emp => ({
      staff_id: emp.staff_id || `${emp.district_code || emp.districtNo}-${emp.department_code || emp.departmentNo}-${emp.staffName}`,
      district_code: emp.district_code || emp.districtNo,
      department_code: emp.department_code || emp.departmentNo,
      shozokuMei: emp.shozokuMei,
      staffName: emp.staffName,
      search_kana: emp.search_kana || emp.katakanaNam
    }));

    res.json({ success: true, data: { employees: normalizedEmployees, total: normalizedEmployees.length } });
  } catch (err) {
    // 入力やファイル状況に依存する想定外エラーは空配列で返却
    res.json({ success: true, data: { employees: [], total: 0 }, warning: { code: 'SOURCE_UNAVAILABLE', message: err.message } });
  }
});

// In-memory products (ファイルベース)
const PRODUCTS = (() => {
  const candidateFiles = [
    path.join(__dirname, 'data', 'products.json'),
    path.join(__dirname, '..', 'data', 'products.json'),
  ];
  
  for (const filePath of candidateFiles) {
    try {
      const p = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(p);
    } catch {
      // try next
    }
  }
  
  // フォールバック用の基本データ
  return [
    { product_id: 'dis-001', category_division: '消毒', category_1: '再処理', category_2: null, product_name: '消毒・再処理', quantity_unit: '㎡', tax_rate: 0.1, basic_price: 0, basic_unit_price: 2500, basic_quantity: 1 },
    { product_id: 'kiso-001', category_division: '基礎関連', category_1: '外基礎', category_2: null, product_name: '外基礎', quantity_unit: 'm', tax_rate: 0.1, height_pricing: { '30': 480000, '40': 540000, '50': 600000, '60': 660000, '70': 720000, '80': 780000 } },
    { product_id: 'etc-001', category_division: 'そのほか', category_1: '一般管理費', category_2: null, product_name: '一般管理費', quantity_unit: '式', tax_rate: 0.1, basic_price: 20000, basic_unit_price: 0, basic_quantity: 1 },
  ];
})();

// GET /api/v1/products/search
app.get('/api/v1/products/search', (req, res) => {
  try {
    const { category_division, category_1, category_2, product_name, is_active } = req.query;
    const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 100);
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    
    let results = PRODUCTS.filter(p => p.is_active !== false); // デフォルトで有効な商品のみ
    
    // フィルタリング
    if (category_division) results = results.filter(p => p.category_division === category_division);
    if (category_1) results = results.filter(p => (p.category_1 || '') === category_1);
    if (category_2) results = results.filter(p => (p.category_2 || '') === category_2);
    if (product_name) results = results.filter(p => (p.product_name || '').toLowerCase().includes(product_name.toLowerCase()));
    if (is_active !== undefined) results = results.filter(p => p.is_active === (is_active === 'true'));
    
    const total = results.length;
    const start = (page - 1) * limit;
    const paginatedResults = results.slice(start, start + limit);
    
    res.json({ 
      success: true, 
      data: { 
        products: paginatedResults, 
        pagination: { 
          page, 
          limit, 
          total, 
          totalPages: Math.ceil(total / limit) 
        } 
      } 
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: { 
        code: 'INTERNAL_ERROR', 
        message: '商品検索でエラーが発生しました' 
      } 
    });
  }
});

// POST /api/v1/products/calculate-price
app.post('/api/v1/products/calculate-price', (req, res) => {
  try {
    const { product_id, quantity = 1, height_cm, length_m } = req.body || {};
    if (!product_id) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'product_id は必須です' } });
    
    const product = PRODUCTS.find(p => p.product_id === product_id);
    if (!product) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: '商品が見つかりません' } });
    
    const q = Math.max(1, parseFloat(quantity) || 1);
    let subtotal = 0;
    let unitPrice = 0;
    
    // 価格計算ロジック
    if (product.category_division === '基礎関連' && product.height_pricing) {
      // 基礎関連の高さ別価格
      const height = Math.min(80, Math.max(30, parseInt(height_cm) || 40));
      const basePrice = product.height_pricing[height] || product.height_pricing[40];
      const length = Math.max(1, parseFloat(length_m) || 1);
      subtotal = basePrice * length;
      unitPrice = basePrice;
    } else if (product.basic_price > 0) {
      // 固定価格商品
      subtotal = product.basic_price;
      unitPrice = product.basic_price;
    } else {
      // 単価×数量商品
      unitPrice = product.basic_unit_price || 0;
      subtotal = unitPrice * q;
    }
    
    const tax = Math.floor(subtotal * (product.tax_rate || 0.1));
    const total = subtotal + tax;
    
    res.json({ 
      success: true, 
      data: { 
        product_id: product.product_id,
        product_name: product.product_name,
        quantity: q,
        unit_price: unitPrice,
        basic_amount: subtotal, 
        excess_amount: 0, 
        subtotal, 
        tax_amount: tax, 
        total,
        detail: { 
          unit_price: unitPrice, 
          tax_rate: product.tax_rate || 0.1,
          quantity_unit: product.quantity_unit
        } 
      } 
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: { 
        code: 'INTERNAL_ERROR', 
        message: '価格計算でエラーが発生しました' 
      } 
    });
  }
});

// -------------------------------
// User Management API (CRUD)
// -------------------------------
const USERS_FILE = path.join(__dirname, '..', 'data', 'users.json');
function readUsersFile() {
  try {
    const raw = fs.readFileSync(USERS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function writeUsersFile(users) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
  } catch (e) {
    // eslint-disable-next-line no-console
    if (!IS_TEST) console.error('users write error:', e.message);
  }
}
function findUser(users, userId) {
  return users.find(u => String(u.userId) === String(userId));
}

// Tighter rate limit for admin APIs: 30 req/min（テスト時は無効）
if (!IS_TEST) app.use('/api/v1/users', rateLimit({ windowMs: 60 * 1000, max: 30 }));

// GET /api/v1/users
app.get('/api/v1/users', authenticateJwt, requireRole('admin'), (req, res) => {
  const q = (req.query.q || '').toString().trim();
  const role = (req.query.role || '').toString().trim();
  const status = (req.query.status || '').toString().trim();
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '20', 10)));
  const users = readUsersFile();
  let filtered = users;
  if (q) {
    filtered = filtered.filter(u => (u.name || '').includes(q) || (u.userId || '').includes(q) || (u.email || '').includes(q));
  }
  if (role) filtered = filtered.filter(u => (u.role || '') === role);
  if (status) filtered = filtered.filter(u => (u.status || '') === status);
  const total = filtered.length;
  const start = (page - 1) * limit;
  const items = filtered.slice(start, start + limit);
  res.json({ success: true, data: { users: items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } } });
});

// POST /api/v1/users
app.post('/api/v1/users', authenticateJwt, requireRole('admin'), async (req, res) => {
  const { userId, name, email, department, role, password, passwordExpiresAt, forcePasswordChange } = req.body || {};
  if (!userId || !name || !email || !department || !role) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'userId, name, email, department, role は必須です' } });
  }
  if (!password) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'password は必須です' } });
  }
  
  // パスワード複雑性チェック
  const passwordErrors = validatePassword(password);
  if (passwordErrors.length > 0) {
    return res.status(400).json({ 
      success: false, 
      error: { 
        code: 'PASSWORD_POLICY_VIOLATION', 
        message: 'パスワードがポリシーを満たしていません', 
        details: passwordErrors 
      } 
    });
  }
  
  const users = readUsersFile();
  if (findUser(users, userId)) {
    return res.status(409).json({ success: false, error: { code: 'DUPLICATE', message: '既に存在するユーザーIDです' } });
  }
  const now = new Date().toISOString();
  const passwordHash = await bcrypt.hash(password, 10);
  const user = {
    userId,
    name,
    email,
    department,
    role, // 'admin' | 'user'
    status: 'active',
    passwordHash,
    lastLogin: null,
    loginFailureCount: 0,
    passwordNeedsReset: forcePasswordChange !== false,
    passwordExpiresAt: passwordExpiresAt || null,
    passwordSetAt: now,
    createdAt: now,
    updatedAt: now,
  };
  users.push(user);
  writeUsersFile(users);
  await auditLog('users.create', { userId }, { ok: true });
  res.status(201).json({ success: true, data: user });
});

// GET /api/v1/users/:id
app.get('/api/v1/users/:id', authenticateJwt, requireRole('admin'), (req, res) => {
  const users = readUsersFile();
  const user = findUser(users, req.params.id);
  if (!user) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'ユーザーが見つかりません' } });
  res.json({ success: true, data: user });
});

// PUT /api/v1/users/:id
app.put('/api/v1/users/:id', authenticateJwt, requireRole('admin'), async (req, res) => {
  const { name, email, department, role, status } = req.body || {};
  const users = readUsersFile();
  const user = findUser(users, req.params.id);
  if (!user) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'ユーザーが見つかりません' } });
  if (name !== undefined) user.name = name;
  if (email !== undefined) user.email = email;
  if (department !== undefined) user.department = department;
  if (role !== undefined) user.role = role;
  if (status !== undefined) user.status = status;
  user.updatedAt = new Date().toISOString();
  writeUsersFile(users);
  await auditLog('users.update', { userId: user.userId }, { ok: true });
  res.json({ success: true, data: user });
});

// DELETE /api/v1/users/:id
app.delete('/api/v1/users/:id', authenticateJwt, requireRole('admin'), async (req, res) => {
  const users = readUsersFile();
  const idx = users.findIndex(u => String(u.userId) === String(req.params.id));
  if (idx === -1) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'ユーザーが見つかりません' } });
  const deleted = users.splice(idx, 1)[0];
  writeUsersFile(users);
  await auditLog('users.delete', { userId: deleted.userId }, { ok: true });
  res.json({ success: true, data: { deleted: true } });
});

// POST /api/v1/users/:id/reset-password
app.post('/api/v1/users/:id/reset-password', authenticateJwt, requireRole('admin'), async (req, res) => {
  const users = readUsersFile();
  const user = findUser(users, req.params.id);
  if (!user) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'ユーザーが見つかりません' } });
  user.passwordNeedsReset = true;
  user.passwordSetAt = null;
  user.updatedAt = new Date().toISOString();
  writeUsersFile(users);
  await auditLog('users.resetPassword', { userId: user.userId }, { ok: true });
  res.json({ success: true, data: { reset: true } });
});

// POST /api/v1/users/:id/unlock
app.post('/api/v1/users/:id/unlock', authenticateJwt, requireRole('admin'), async (req, res) => {
  const users = readUsersFile();
  const user = findUser(users, req.params.id);
  if (!user) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'ユーザーが見つかりません' } });
  user.status = 'active';
  user.loginFailureCount = 0;
  user.updatedAt = new Date().toISOString();
  writeUsersFile(users);
  await auditLog('users.unlock', { userId: user.userId }, { ok: true });
  res.json({ success: true, data: { unlocked: true } });
});

// -------------------------------
// Authentication (minimal JWT)
// -------------------------------

function generateJwtToken(user, expiresIn = '1h') {
  const payload = { sub: String(user.userId), role: user.role || 'user' };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: IS_TEST ? '5m' : expiresIn });
}

function authenticateJwt(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
    if (!token) return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Bearer token required' } });
    const decoded = jwt.verify(token, JWT_SECRET);
    req.auth = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid token' } });
  }
}

function requireRole(role) {
  return (req, res, next) => {
    const currentRole = req.auth?.role || 'user';
    if (currentRole !== role) return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'insufficient role' } });
    next();
  };
}

// パスワード複雑性チェック
function validatePassword(password) {
  const errors = [];
  
  if (password.length < 8) {
    errors.push('パスワードは8文字以上である必要があります');
  }
  
  if (!/[a-z]/.test(password)) {
    errors.push('小文字を含む必要があります');
  }
  
  if (!/[A-Z]/.test(password)) {
    errors.push('大文字を含む必要があります');
  }
  
  if (!/[0-9]/.test(password)) {
    errors.push('数字を含む必要があります');
  }
  
  if (!/[^A-Za-z0-9]/.test(password)) {
    errors.push('記号を含む必要があります');
  }
  
  return errors;
}

// POST /auth/login
app.post('/auth/login', async (req, res) => {
  const { userId, password } = req.body || {};
  if (!userId) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'userId は必須です' } });
  if (!password) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'password は必須です' } });
  const users = readUsersFile();
  const user = findUser(users, userId);
  if (!user) return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'ユーザーが見つかりません' } });

  // パスワード検証
  const isValidPassword = await bcrypt.compare(password, user.passwordHash || '');
  if (!isValidPassword) {
    user.loginFailureCount = (user.loginFailureCount || 0) + 1;
    if (user.loginFailureCount >= 5) {
      user.status = 'locked';
      user.lockedAt = new Date().toISOString();
    }
    writeUsersFile(users);
    return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'パスワードが正しくありません' } });
  }

  // パスワード期限チェック
  if (user.passwordExpiresAt && new Date(user.passwordExpiresAt) < new Date()) {
    return res.status(401).json({ success: false, error: { code: 'PASSWORD_EXPIRED', message: 'パスワードの有効期限が切れています' } });
  }

  // 強制パスワード変更チェック
  if (user.passwordNeedsReset) {
    return res.status(401).json({ success: false, error: { code: 'PASSWORD_RESET_REQUIRED', message: 'パスワードの変更が必要です' } });
  }

  user.lastLogin = new Date().toISOString();
  user.loginFailureCount = 0;
  writeUsersFile(users);
  
  // アクセストークンとリフレッシュトークンを生成
  const accessToken = generateJwtToken(user, '15m');
  const refreshToken = generateJwtToken(user, '7d');
  
  res.json({ 
    success: true, 
    data: { 
      accessToken, 
      refreshToken, 
      user: { userId: user.userId, role: user.role, name: user.name } 
    } 
  });
});

// GET /auth/me
app.get('/auth/me', authenticateJwt, (req, res) => {
  const users = readUsersFile();
  const user = findUser(users, req.auth?.sub);
  if (!user) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'ユーザーが見つかりません' } });
  res.json({ success: true, data: { user: { userId: user.userId, role: user.role, name: user.name } } });
});

// POST /auth/refresh
app.post('/auth/refresh', async (req, res) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'refreshToken は必須です' } });
  }
  
  try {
    const decoded = jwt.verify(refreshToken, JWT_SECRET);
    const users = readUsersFile();
    const user = findUser(users, decoded.sub);
    
    if (!user || user.status !== 'active') {
      return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: '無効なリフレッシュトークンです' } });
    }
    
    // 新しいアクセストークンを生成
    const newAccessToken = generateJwtToken(user, '15m');
    
    res.json({ 
      success: true, 
      data: { 
        accessToken: newAccessToken,
        user: { userId: user.userId, role: user.role, name: user.name } 
      } 
    });
  } catch (error) {
    return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: '無効なリフレッシュトークンです' } });
  }
});

// POST /auth/logout
app.post('/auth/logout', authenticateJwt, (req, res) => {
  // 実際の実装では、リフレッシュトークンをブラックリストに追加する
  // ここでは単純に成功レスポンスを返す
  res.json({ success: true, message: 'ログアウトしました' });
});

// Example admin-guarded endpoint
app.get('/api/v1/admin/ping', authenticateJwt, requireRole('admin'), (req, res) => {
  res.json({ success: true, data: { pong: true } });
});

// GET /api/v1/circuit-breaker/status
app.get('/api/v1/circuit-breaker/status', (req, res) => {
  res.json({
    success: true,
    data: {
      sheets: sheetsCircuitBreaker.getStatus(),
      timestamp: new Date().toISOString()
    }
  });
});

// GET /api/v1/audit-logs/search
app.get('/api/v1/audit-logs/search', authenticateJwt, requireRole('admin'), async (req, res) => {
  try {
    const filters = {
      action: req.query.action,
      userId: req.query.userId,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      success: req.query.success === 'true' ? true : req.query.success === 'false' ? false : undefined,
      page: parseInt(req.query.page || '1', 10),
      limit: parseInt(req.query.limit || '100', 10)
    };
    
    const result = await searchAuditLogs(filters);
    res.json({ success: true, data: result });
  } catch (error) {
    sendErrorResponse(res, ERROR_CODES.INTERNAL_ERROR, '監査ログの検索でエラーが発生しました', { details: error.message }, 500);
  }
});

// GET /api/v1/audit-logs/stats
app.get('/api/v1/audit-logs/stats', authenticateJwt, requireRole('admin'), async (req, res) => {
  try {
    const stats = await getAuditStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    sendErrorResponse(res, ERROR_CODES.INTERNAL_ERROR, '監査ログの統計取得でエラーが発生しました', { details: error.message }, 500);
  }
});

// -------------------------------
// Error Response Helpers
// -------------------------------
function createErrorResponse(code, message, details = null, statusCode = 400) {
  const error = { code, message };
  if (details) error.details = details;
  return { success: false, error, statusCode };
}

function sendErrorResponse(res, code, message, details = null, statusCode = 400) {
  const errorResponse = createErrorResponse(code, message, details, statusCode);
  res.status(statusCode).json(errorResponse);
}

// エラーコード定数
const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  DUPLICATE: 'DUPLICATE',
  EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  RATE_LIMITED: 'RATE_LIMITED',
  PASSWORD_POLICY_VIOLATION: 'PASSWORD_POLICY_VIOLATION',
  PASSWORD_EXPIRED: 'PASSWORD_EXPIRED',
  PASSWORD_RESET_REQUIRED: 'PASSWORD_RESET_REQUIRED',
  INTERNAL_ERROR: 'INTERNAL_ERROR'
};

// -------------------------------
// Circuit Breaker for Google Sheets
// -------------------------------
class CircuitBreaker {
  constructor(failureThreshold = 5, recoveryTimeout = 60000) {
    this.failureThreshold = failureThreshold;
    this.recoveryTimeout = recoveryTimeout;
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
  }

  async execute(operation) {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.recoveryTimeout) {
        this.state = 'HALF_OPEN';
      } else {
        throw new Error('Circuit breaker is OPEN');
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  onSuccess() {
    this.failureCount = 0;
    this.state = 'CLOSED';
  }

  onFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
    }
  }

  getStatus() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
      isOpen: this.state === 'OPEN'
    };
  }
}

// サーキットブレーカーのインスタンス
const sheetsCircuitBreaker = new CircuitBreaker(5, 60000); // 5回失敗で60秒間オープン

// Start (only when run directly)
if (require.main === module) {
  app.listen(PORT, () => {
    // Ensure folders for logs/data exist
    const logsDir = path.join(__dirname, '..', 'logs');
    const dataDir = path.join(__dirname, '..', 'data');
    try { fs.mkdirSync(logsDir, { recursive: true }); } catch {}
    try { fs.mkdirSync(dataDir, { recursive: true }); } catch {}
    // Initialize users file if missing
    try { if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]', 'utf8'); } catch {}
    // eslint-disable-next-line no-console
    console.log(`API server running on http://localhost:${PORT}`);
  });
}

module.exports = app;
