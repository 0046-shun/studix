const request = require('supertest');
const app = require('../src/server');

// Helper to create admin user for testing
async function createTestAdmin() {
  // Bypass auth for test setup by temporarily removing middleware
  const server = require('../src/server');
  const originalUsersRoute = server._router.stack.find(layer => layer.route && layer.route.path === '/api/v1/users');
  
  // Create user directly in test
  const fs = require('fs');
  const path = require('path');
  const usersFile = path.join(__dirname, '..', 'data', 'users.json');
  const bcrypt = require('bcryptjs');
  
  const passwordHash = await bcrypt.hash('Passw0rd!', 10);
  const testUser = {
    userId: 'admin1',
    name: '管理者',
    email: 'admin@example.com',
    department: '本社',
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

describe('Auth API', () => {
  test('login and me flow', async () => {
    // Create test admin user
    await createTestAdmin();

    // Login
    const loginRes = await request(app).post('/auth/login').send({ userId: 'admin1', password: 'Passw0rd!' });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.success).toBe(true);
    const accessToken = loginRes.body.data.accessToken;
    expect(typeof accessToken).toBe('string');

    // Me
    const meRes = await request(app).get('/auth/me').set('Authorization', `Bearer ${accessToken}`);
    expect(meRes.status).toBe(200);
    expect(meRes.body.success).toBe(true);
    expect(meRes.body.data.user.userId).toBe('admin1');

    // Admin ping
    const pingRes = await request(app).get('/api/v1/admin/ping').set('Authorization', `Bearer ${accessToken}`);
    expect(pingRes.status).toBe(200);
    expect(pingRes.body.success).toBe(true);
  });

  test('rejects when no token', async () => {
    const res = await request(app).get('/auth/me');
    expect(res.status).toBe(401);
  });
});


