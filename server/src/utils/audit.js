const fs = require('fs');
const path = require('path');

async function auditLog(action, payload, result) {
  const dir = path.join(__dirname, '..', '..', 'logs');
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  const file = path.join(dir, 'audit.log');
  const entry = {
    time: new Date().toISOString(),
    action,
    payload,
    result
  };
  fs.appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8');
}

module.exports = { auditLog };
