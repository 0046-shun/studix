const fs = require('fs');
const path = require('path');
const request = require('supertest');

const app = require('../src/server');

function setupTempUsersDir() {
  const dataDir = path.join(__dirname, '..', 'data');
  try { fs.mkdirSync(dataDir, { recursive: true }); } catch {}
  const usersFile = path.join(dataDir, 'users.json');
  fs.writeFileSync(usersFile, '[]', 'utf8');
}

// Helper to create test user for CRUD testing
async function createTestUser() {
  const fs = require('fs');
  const path = require('path');
  const bcrypt = require('bcryptjs');
  const usersFile = path.join(__dirname, '..', 'data', 'users.json');
  
  const passwordHash = await bcrypt.hash('Passw0rd!', 10);
  const testUser = {
    userId: 'testuser',
    name: 'テスト ユーザー',
    email: 'test@example.com',
    department: '本社事務部',
    role: 'admin',
    passwordHash,
    status: 'active',
    lastLogin: null,
    loginFailureCount: 0,
    passwordNeedsReset: false,
    passwordExpiresAt: null,
    passwordSetAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  
  const users = [];
  users.push(testUser);
  fs.writeFileSync(usersFile, JSON.stringify(users, null, 2), 'utf8');
  return testUser;
}

describe('Products/Employees/Users API', () => {
  beforeAll(() => {
    setupTempUsersDir();
  });

  test('GET /api/v1/health', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('ok');
  });

  test('GET /api/v1/products/search', async () => {
    const res = await request(app).get('/api/v1/products/search').query({ product_name: '消毒' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.products)).toBe(true);
  });

  test('POST /api/v1/products/calculate-price', async () => {
    const res = await request(app).post('/api/v1/products/calculate-price').send({ product_id: 'etc-001', quantity: 1 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.total).toBeGreaterThan(0);
  });

  test('POST /api/v1/products/calculate-price (kiso height variants)', async () => {
    const res40 = await request(app).post('/api/v1/products/calculate-price').send({ product_id: 'kiso-001', height_cm: 40, length_m: 1 });
    const res60 = await request(app).post('/api/v1/products/calculate-price').send({ product_id: 'kiso-001', height_cm: 60, length_m: 1 });
    expect(res40.status).toBe(200);
    expect(res60.status).toBe(200);
    
    const total40 = res40.body.data.total; // 540000 + 10% = 594000
    const total60 = res60.body.data.total; // 660000 + 10% = 726000
    expect(total40).toBe(594000);
    expect(total60).toBe(726000);
  });

  test('GET /api/v1/employees/search', async () => {
    const res = await request(app).get('/api/v1/employees/search').query({ name_kana: '' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('employees');
  });

  test('Users CRUD', async () => {
    // Create test user directly
    const testUser = await createTestUser();

    // Login to get token for admin access
    const loginRes = await request(app).post('/auth/login').send({ 
      userId: 'testuser', 
      password: 'Passw0rd!' 
    });
    expect(loginRes.status).toBe(200);
    const accessToken = loginRes.body.data.accessToken;

    // List (requires admin role)
    const listRes = await request(app).get('/api/v1/users').set('Authorization', `Bearer ${accessToken}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.success).toBe(true);
    const target = (listRes.body.data.users || []).find(u => u.userId === 'testuser');
    expect(target).toBeTruthy();

    // Get (requires admin role)
    const getRes = await request(app).get('/api/v1/users/testuser').set('Authorization', `Bearer ${accessToken}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.success).toBe(true);

    // Update (requires admin role)
    const putRes = await request(app).put('/api/v1/users/testuser').set('Authorization', `Bearer ${accessToken}`).send({ status: 'inactive' });
    expect(putRes.status).toBe(200);
    expect(putRes.body.data.status).toBe('inactive');

    // Reset password (requires admin role)
    const resetRes = await request(app).post('/api/v1/users/testuser/reset-password').set('Authorization', `Bearer ${accessToken}`);
    expect(resetRes.status).toBe(200);

    // Unlock (requires admin role)
    const unlockRes = await request(app).post('/api/v1/users/testuser/unlock').set('Authorization', `Bearer ${accessToken}`);
    expect(unlockRes.status).toBe(200);

    // Delete (requires admin role)
    const delRes = await request(app).delete('/api/v1/users/testuser').set('Authorization', `Bearer ${accessToken}`);
    expect(delRes.status).toBe(200);
    expect(delRes.body.data.deleted).toBe(true);
  });
});
