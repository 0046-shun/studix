const request = require('supertest');
const app = require('../src/server');

(async () => {
  try {
    const res = await request(app)
      .get('/api/v1/employees/search')
      .query({ limit: 10 });
    if (!res.body || !res.body.success) {
      console.error('API error:', res.status, res.body);
      process.exit(1);
    }
    const employees = res.body.data?.employees || [];
    console.log(`employees count: ${employees.length}`);
    console.log(JSON.stringify(employees, null, 2));
    process.exit(0);
  } catch (e) {
    console.error('request failed:', e);
    process.exit(2);
  }
})();
