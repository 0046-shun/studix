const request = require('supertest');

// Mock googleSheetsService to avoid actual IO
jest.mock('../src/services/googleSheetsService', () => ({
  appendOrderRow: jest.fn(async () => ({ appended: true })),
  appendRequestRow: jest.fn(async () => ({ appended: true })),
}));

const app = require('../src/server');
const { appendOrderRow, appendRequestRow } = require('../src/services/googleSheetsService');

describe('Orders/Requests API', () => {
  test('POST /api/v1/orders/sheets (orders only)', async () => {
    const payload = {
      order: {
        reception_date: '2025-08-09',
        greeting_time: '10:30',
        customer: { name: '山田太郎', age: 70, phone_fixed: '092-000-0000', phone_mobile: '090-000-0000' },
        items: [{ product_name: '外基礎', quantity: 1, price_ex_tax: 540000 }],
      },
      staff: { display_name: '田中', district_code: '511', department_code: '7' },
    };
    const res = await request(app).post('/api/v1/orders/sheets').send(payload);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(appendOrderRow).toHaveBeenCalled();
  });

  test('POST /api/v1/requests/sheets (with request)', async () => {
    const payload = {
      request_text: '工期短縮希望',
      staff: { display_name: '田中', district_code: '511', department_code: '7' },
      created_at: '2025-08-09T10:15:24Z',
    };
    const res = await request(app).post('/api/v1/requests/sheets').send(payload);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(appendRequestRow).toHaveBeenCalled();
  });

  test('POST /api/v1/requests/sheets validation error when empty', async () => {
    const payload = { request_text: '   ', staff: { display_name: '田中', district_code: '511', department_code: '7' } };
    const res = await request(app).post('/api/v1/requests/sheets').send(payload);
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('POST /api/v1/requests/sheets handles external failure', async () => {
    appendRequestRow.mockImplementation(async () => { throw new Error('sheets down'); });
    const payload = {
      request_text: '再送テスト',
      staff: { display_name: '田中', district_code: '511', department_code: '7' },
    };
    const res = await request(app).post('/api/v1/requests/sheets').send(payload);
    expect(res.status).toBe(502);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('EXTERNAL_SERVICE_ERROR');
    // restore to success for other tests (if any followed)
    appendRequestRow.mockImplementation(async () => ({ appended: true }));
  });
});
