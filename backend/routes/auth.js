const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { createSession, destroySession, requireAuth } = require('../middleware/auth');

const router = express.Router();

function isSetup() {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'business_name'`).get();
  return !!(row && row.value);
}

// GET /api/auth/status - does the app need first-run setup?
router.get('/status', (req, res) => {
  res.json({ isSetup: isSetup() });
});

// POST /api/auth/setup - first-run wizard: business profile + first admin user.
// This is where the industry/business name gets entered, exactly once, on install.
router.post('/setup', (req, res) => {
  if (isSetup()) return res.status(400).json({ error: 'Already set up' });
  const { businessName, industry, address, phone, currency, adminName, adminPin } = req.body;
  if (!businessName || !adminName || !adminPin) {
    return res.status(400).json({ error: 'businessName, adminName and adminPin are required' });
  }
  const setSetting = db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
  setSetting.run('business_name', businessName);
  setSetting.run('industry', industry || 'Plastic bag manufacturing');
  setSetting.run('address', address || '');
  setSetting.run('phone', phone || '');
  setSetting.run('currency', currency || 'KES');
  setSetting.run('receipt_counter', '0');

  const pinHash = bcrypt.hashSync(String(adminPin), 8);
  const info = db.prepare(`INSERT INTO users (name, pin_hash, role) VALUES (?, ?, 'admin')`)
    .run(adminName, pinHash);

  const user = { id: info.lastInsertRowid, name: adminName, role: 'admin' };
  const token = createSession(user);
  res.json({ token, user });
});

// GET /api/auth/settings - public business profile (shown on receipts, header)
router.get('/settings', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  rows.forEach(r => { settings[r.key] = r.value; });
  res.json(settings);
});

// PUT /api/auth/settings - admin can edit business profile later
router.put('/settings', requireAuth('admin'), (req, res) => {
  const allowed = ['business_name', 'industry', 'address', 'phone', 'currency'];
  const setSetting = db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
  for (const key of allowed) {
    if (req.body[key] !== undefined) setSetting.run(key, String(req.body[key]));
  }
  res.json({ ok: true });
});

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { userId, pin } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(userId);
  if (!user || !bcrypt.compareSync(String(pin || ''), user.pin_hash)) {
    return res.status(401).json({ error: 'Wrong PIN' });
  }
  const token = createSession(user);
  res.json({ token, user: { id: user.id, name: user.name, role: user.role } });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) destroySession(token);
  res.json({ ok: true });
});

// GET /api/auth/users - list staff for the login picker (id, name, role only)
router.get('/users', (req, res) => {
  const users = db.prepare('SELECT id, name, role FROM users WHERE active = 1').all();
  res.json(users);
});

// POST /api/auth/users - admin creates a staff account
router.post('/users', requireAuth('admin'), (req, res) => {
  const { name, pin, role } = req.body;
  if (!name || !pin || !['admin', 'cashier', 'production'].includes(role)) {
    return res.status(400).json({ error: 'name, pin and a valid role are required' });
  }
  const pinHash = bcrypt.hashSync(String(pin), 8);
  const info = db.prepare('INSERT INTO users (name, pin_hash, role) VALUES (?, ?, ?)')
    .run(name, pinHash, role);
  res.json({ id: info.lastInsertRowid, name, role });
});

// DELETE /api/auth/users/:id - admin deactivates a staff account
router.delete('/users/:id', requireAuth('admin'), (req, res) => {
  db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
