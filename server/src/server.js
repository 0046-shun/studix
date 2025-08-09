const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const fs = require('fs');
const path = require('path');

const { appendOrderRow, appendRequestRow } = require('./services/googleSheetsService');
const { withRetry } = require('./utils/retry');
const { auditLog } = require('./utils/audit');

const PORT = process.env.PORT || 3000;
const IS_TEST = process.env.NODE_ENV === 'test';

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
  res.json({ success: true, data: { status: 'ok', time: new Date().toISOString() } });
});

// POST /api/v1/orders/sheets
app.post('/api/v1/orders/sheets', async (req, res) => {
  const body = req.body || {};
  const order = body.order;
  const staff = body.staff;
  if (!order || !staff) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'order と staff は必須です' } });
  }
  try {
    const result = await withRetry(() => appendOrderRow(order, staff), { attempts: 3, baseDelayMs: IS_TEST ? 1 : 500 });
    await auditLog('orders.append', { order, staff }, { ok: true, result });
    res.json({ success: true, data: result || { appended: true } });
  } catch (err) {
    await auditLog('orders.append', { order, staff }, { ok: false, message: err.message });
    res.status(502).json({ success: false, error: { code: 'EXTERNAL_SERVICE_ERROR', message: 'Orders Sheet への転記に失敗しました', details: err.message } });
  }
});

// POST /api/v1/requests/sheets
app.post('/api/v1/requests/sheets', async (req, res) => {
  const body = req.body || {};
  const requestText = (body.request_text || '').toString().trim();
  const staff = body.staff;
  const createdAt = body.created_at || new Date().toISOString();
  if (!requestText) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'request_text は必須です' } });
  }
  if (!staff) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'staff は必須です' } });
  }
  try {
    const result = await withRetry(() => appendRequestRow(requestText, staff, createdAt), { attempts: 3, baseDelayMs: IS_TEST ? 1 : 500 });
    await auditLog('requests.append', { requestText, staff, createdAt }, { ok: true, result });
    res.json({ success: true, data: result || { appended: true } });
  } catch (err) {
    await auditLog('requests.append', { requestText, staff, createdAt }, { ok: false, message: err.message });
    res.status(502).json({ success: false, error: { code: 'EXTERNAL_SERVICE_ERROR', message: 'Requests Sheet への転記に失敗しました', details: err.message } });
  }
});

// -------------------------------
// Task 2: 検索API（モック/ファイルベース）
// -------------------------------

// GET /api/v1/employees/search
app.get('/api/v1/employees/search', async (req, res) => {
  try {
    const kana = (req.query.name_kana || '').toString();
    const district = (req.query.district_code || '').toString();
    const dept = (req.query.department_code || '').toString();
    const limit = Math.min(parseInt(req.query.limit || '20', 10) || 20, 100);

    const file = path.join(__dirname, '..', '..', 'tantou', 'test-staff.json');
    let list = [];
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const parsed = JSON.parse(raw || '[]');
      list = Array.isArray(parsed) ? parsed : [];
    } catch {
      list = [];
    }

    const filtered = list.filter((e) => {
      const okKana = kana ? (e.search_kana || '').includes(kana) : true;
      const okDistrict = district ? String(e.district_code || '') === district : true;
      const okDept = dept ? String(e.department_code || '') === dept : true;
      return okKana && okDistrict && okDept;
    }).slice(0, limit);

    res.json({ success: true, data: { employees: filtered, total: filtered.length } });
  } catch (err) {
    // 入力やファイル状況に依存する想定外エラーは空配列で返却
    res.json({ success: true, data: { employees: [], total: 0 }, warning: { code: 'SOURCE_UNAVAILABLE', message: err.message } });
  }
});

// In-memory products (簡易)
const PRODUCTS = (() => {
  try {
    const p = fs.readFileSync(path.join(__dirname, 'data', 'products.json'), 'utf8');
    return JSON.parse(p);
  } catch {
    return [
      { product_id: 'dis-001', category_division: '消毒', category_1: '再', category_2: null, product_name: '消毒・再処理', quantity_unit: '㎡', tax_rate: 0.1, basic_price: 0, basic_unit_price: 2500, basic_quantity: 1 },
      { product_id: 'dis-002', category_division: 'そのほか', category_1: 'カビ', category_2: null, product_name: 'カビ処理', quantity_unit: '㎡', tax_rate: 0.1, basic_price: 0, basic_unit_price: 2500, basic_quantity: 1 },
      { product_id: 'dis-003', category_division: 'そのほか', category_1: 'BM', category_2: null, product_name: 'BM処理', quantity_unit: '式', tax_rate: 0.1, basic_price: 0, basic_unit_price: 3300, basic_quantity: 1 },
      { product_id: 'kiso-001', category_division: '基礎関連', category_1: '外基礎', category_2: null, product_name: '外基礎', quantity_unit: 'm', tax_rate: 0.1 },
      { product_id: 'etc-001', category_division: 'そのほか', category_1: '一般管理費', category_2: null, product_name: '一般管理費', quantity_unit: '式', tax_rate: 0.1, basic_price: 20000, basic_unit_price: 0, basic_quantity: 1 },
    ];
  }
})();

// GET /api/v1/products/search
app.get('/api/v1/products/search', (req, res) => {
  const { category_division, category_1, category_2, product_name } = req.query;
  const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 100);
  let results = PRODUCTS;
  if (category_division) results = results.filter(p => p.category_division === category_division);
  if (category_1) results = results.filter(p => (p.category_1 || '') === category_1);
  if (category_2) results = results.filter(p => (p.category_2 || '') === category_2);
  if (product_name) results = results.filter(p => (p.product_name || '').includes(product_name));
  results = results.slice(0, limit);
  res.json({ success: true, data: { products: results, pagination: { page: 1, limit, total: results.length, totalPages: 1 } } });
});

// POST /api/v1/products/calculate-price
app.post('/api/v1/products/calculate-price', (req, res) => {
  const { product_id, quantity = 1, height_cm } = req.body || {};
  if (!product_id) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'product_id は必須です' } });
  const q = Math.max(1, parseFloat(quantity) || 1);
  let subtotal = 0;
  // 簡易計算: 基礎は高さ別、その他は単価×数量 or 固定
  if (product_id === 'kiso-001') {
    const table = { 30: 480000, 40: 540000, 50: 600000, 60: 660000, 70: 720000, 80: 780000 };
    const base = table[String(height_cm)] || table[40];
    subtotal = base; // 長さ加算は省略
  } else if (product_id === 'etc-001') {
    subtotal = 20000;
  } else {
    const p = PRODUCTS.find(x => x.product_id === product_id);
    const unitPrice = p?.basic_unit_price || 0;
    subtotal = unitPrice * q;
  }
  const tax = Math.floor(subtotal * 0.1);
  const total = subtotal + tax;
  res.json({ success: true, data: { basic_amount: subtotal, excess_amount: 0, subtotal, tax_amount: tax, total, detail: { unit_price: undefined, tax_rate: 0.1 } } });
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
app.get('/api/v1/users', (req, res) => {
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
app.post('/api/v1/users', async (req, res) => {
  const { userId, name, email, department, role, password, passwordExpiresAt, forcePasswordChange } = req.body || {};
  if (!userId || !name || !email || !department || !role) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'userId, name, email, department, role は必須です' } });
  }
  const users = readUsersFile();
  if (findUser(users, userId)) {
    return res.status(409).json({ success: false, error: { code: 'DUPLICATE', message: '既に存在するユーザーIDです' } });
  }
  const now = new Date().toISOString();
  const user = {
    userId,
    name,
    email,
    department,
    role, // 'admin' | 'user'
    status: 'active',
    lastLogin: null,
    loginFailureCount: 0,
    passwordNeedsReset: forcePasswordChange !== false,
    passwordExpiresAt: passwordExpiresAt || null,
    passwordSetAt: password ? now : null,
    createdAt: now,
    updatedAt: now,
  };
  users.push(user);
  writeUsersFile(users);
  await auditLog('users.create', { userId }, { ok: true });
  res.status(201).json({ success: true, data: user });
});

// GET /api/v1/users/:id
app.get('/api/v1/users/:id', (req, res) => {
  const users = readUsersFile();
  const user = findUser(users, req.params.id);
  if (!user) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'ユーザーが見つかりません' } });
  res.json({ success: true, data: user });
});

// PUT /api/v1/users/:id
app.put('/api/v1/users/:id', async (req, res) => {
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
app.delete('/api/v1/users/:id', async (req, res) => {
  const users = readUsersFile();
  const idx = users.findIndex(u => String(u.userId) === String(req.params.id));
  if (idx === -1) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'ユーザーが見つかりません' } });
  const deleted = users.splice(idx, 1)[0];
  writeUsersFile(users);
  await auditLog('users.delete', { userId: deleted.userId }, { ok: true });
  res.json({ success: true, data: { deleted: true } });
});

// POST /api/v1/users/:id/reset-password
app.post('/api/v1/users/:id/reset-password', async (req, res) => {
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
app.post('/api/v1/users/:id/unlock', async (req, res) => {
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
