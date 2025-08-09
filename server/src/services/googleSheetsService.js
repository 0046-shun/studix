const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const EMULATE = process.env.GOOGLE_SHEETS_EMULATE === 'true' || true; // default emulate true
const ORDERS_SHEET_ID = process.env.SHEET_ID_ORDERS || 'ORDERS_SHEET_ID';
const REQUESTS_SHEET_ID = process.env.SHEET_ID_REQUESTS || 'REQUESTS_SHEET_ID';

async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  const authClient = await auth.getClient();
  return google.sheets({ version: 'v4', auth: authClient });
}

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
}

function toCsvLine(fields) {
  return fields.map(v => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }).join(',') + '\n';
}

function mapOrderToRow(order, staff) {
  // Column order per docs
  const customer = order.customer || {};
  const item = (order.items && order.items[0]) || {};
  const construction = order.construction || {};
  return [
    new Date().toISOString(),
    order.reception_date || '',
    order.greeting_time || '',
    staff.display_name || '',
    staff.district_code || '',
    staff.department_code || '',
    customer.name || '',
    customer.age ?? '',
    customer.phone_fixed || '',
    customer.phone_mobile || '',
    item.product_name || order.product_name || '',
    item.quantity ?? order.quantity ?? '',
    item.unit || order.unit || '',
    item.amount_ex_tax ?? order.amount_ex_tax ?? '',
    order.contract_date || '',
    construction.start_date || order.start_date || '',
    construction.time_slot || order.time_slot || '',
    construction.end_date || order.end_date || '',
    order.payment_method || '',
    order.reception_staff || '',
    order.flyer || '',
    order.estimate_no || '',
    order.other_company ?? '',
    order.history ?? '',
    order.current ?? '',
    order.total_history ?? '',
    order.trigger ?? '',
    order.remarks || ''
  ];
}

function mapRequestToRow(requestText, staff, createdAt) {
  return [
    createdAt || new Date().toISOString(),
    staff.district_code || '',
    staff.department_code || '',
    staff.display_name || '',
    requestText
  ];
}

async function appendOrderRow(order, staff) {
  if (EMULATE) {
    const file = path.join(__dirname, '..', '..', 'data', 'orders.csv');
    ensureDir(file);
    const row = mapOrderToRow(order, staff);
    fs.appendFileSync(file, toCsvLine(row), 'utf8');
    return { emulated: true, file };
  }
  const sheets = await getSheetsClient();
  const values = [mapOrderToRow(order, staff)];
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId: ORDERS_SHEET_ID,
    range: 'A1',
    valueInputOption: 'RAW',
    requestBody: { values }
  });
  return { updatedRange: res.data.updates?.updatedRange };
}

async function appendRequestRow(requestText, staff, createdAt) {
  if (EMULATE) {
    const file = path.join(__dirname, '..', '..', 'data', 'requests.csv');
    ensureDir(file);
    const row = mapRequestToRow(requestText, staff, createdAt);
    fs.appendFileSync(file, toCsvLine(row), 'utf8');
    return { emulated: true, file };
  }
  const sheets = await getSheetsClient();
  const values = [mapRequestToRow(requestText, staff, createdAt)];
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId: REQUESTS_SHEET_ID,
    range: 'A1',
    valueInputOption: 'RAW',
    requestBody: { values }
  });
  return { updatedRange: res.data.updates?.updatedRange };
}

module.exports = { appendOrderRow, appendRequestRow };
