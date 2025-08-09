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
    const res40 = await request(app).post('/api/v1/products/calculate-price').send({ product_id: 'kiso-001', height_cm: 40 });
    const res60 = await request(app).post('/api/v1/products/calculate-price').send({ product_id: 'kiso-001', height_cm: 60 });
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
    // Create
    const createRes = await request(app).post('/api/v1/users').send({
      userId: 'testuser', name: 'テスト ユーザー', email: 'test@example.com', department: '本社事務部', role: 'user', password: 'Passw0rd!'
    });
    expect([200, 201]).toContain(createRes.status);
    expect(createRes.body.success).toBe(true);

    // List
    const listRes = await request(app).get('/api/v1/users');
    expect(listRes.status).toBe(200);
    expect(listRes.body.success).toBe(true);
    const target = (listRes.body.data.users || []).find(u => u.userId === 'testuser');
    expect(target).toBeTruthy();

    // Get
    const getRes = await request(app).get('/api/v1/users/testuser');
    expect(getRes.status).toBe(200);
    expect(getRes.body.success).toBe(true);

    // Update
    const putRes = await request(app).put('/api/v1/users/testuser').send({ status: 'inactive' });
    expect(putRes.status).toBe(200);
    expect(putRes.body.data.status).toBe('inactive');

    // Reset password
    const resetRes = await request(app).post('/api/v1/users/testuser/reset-password');
    expect(resetRes.status).toBe(200);

    // Unlock
    const unlockRes = await request(app).post('/api/v1/users/testuser/unlock');
    expect(unlockRes.status).toBe(200);

    // Delete
    const delRes = await request(app).delete('/api/v1/users/testuser');
    expect(delRes.status).toBe(200);
    expect(delRes.body.data.deleted).toBe(true);
  });
});
