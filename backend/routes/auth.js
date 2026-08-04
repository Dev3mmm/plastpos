const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { createSession, destroySession, requireAuth } = require('../middleware/auth');

const VALID_ROLES = ['admin', 'cashier', 'input', 'cutting', 'distribution'];

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

// GET /api/auth/users/detailed - admin-only, includes pay rate and shift
// schedule for the Settings screen (kept separate from the public picker
// above so pay rates aren't exposed pre-login)
router.get('/users/detailed', requireAuth('admin'), (req, res) => {
  res.json(db.prepare('SELECT id, name, role, piece_rate, shift_start, shift_end FROM users WHERE active = 1').all());
});

// POST /api/auth/users - admin creates a staff account, one per role/section.
// piece_rate is pay per unit of that role's output (KES per kg of rolls,
// per bag cut, per packet dispatched) - 0 means salaried / not piece-rated.
router.post('/users', requireAuth('admin'), (req, res) => {
  const { name, pin, role, piece_rate } = req.body;
  if (!name || !pin || !VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: `name, pin and a valid role (${VALID_ROLES.join(', ')}) are required` });
  }
  const pinHash = bcrypt.hashSync(String(pin), 8);
  const info = db.prepare('INSERT INTO users (name, pin_hash, role, piece_rate) VALUES (?, ?, ?, ?)')
    .run(name, pinHash, role, Number(piece_rate) || 0);
  res.json({ id: info.lastInsertRowid, name, role, piece_rate: Number(piece_rate) || 0 });
});

// PUT /api/auth/users/:id - admin edits an existing staff account's pay
// rate and/or shift schedule (shift_start/shift_end as "HH:MM", used for
// the on-WiFi shift alarm)
router.put('/users/:id', requireAuth('admin'), (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  const { piece_rate, name, shift_start, shift_end } = req.body;
  db.prepare('UPDATE users SET name = ?, piece_rate = ?, shift_start = ?, shift_end = ? WHERE id = ?')
    .run(name ?? user.name, piece_rate != null ? Number(piece_rate) : user.piece_rate,
      shift_start !== undefined ? shift_start : user.shift_start,
      shift_end !== undefined ? shift_end : user.shift_end, req.params.id);
  res.json(db.prepare('SELECT id, name, role, piece_rate, shift_start, shift_end FROM users WHERE id = ?').get(req.params.id));
});

// DELETE /api/auth/users/:id - admin deactivates a staff account
router.delete('/users/:id', requireAuth('admin'), (req, res) => {
  db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---- System lock: instantly blocks everyone except admin, without
// touching the router or network at all ----
router.get('/lock', requireAuth('admin'), (req, res) => {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'system_locked'`).get();
  res.json({ locked: row && row.value === '1' });
});
router.put('/lock', requireAuth('admin'), (req, res) => {
  const locked = req.body.locked ? '1' : '0';
  db.prepare(`INSERT INTO settings (key, value) VALUES ('system_locked', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(locked);
  res.json({ locked: locked === '1' });
});

// ---- Active sessions: see who is logged in right now, and force any of
// them out - the practical equivalent of "choose who can access it" ----
router.get('/sessions', requireAuth('admin'), (req, res) => {
  const rows = db.prepare('SELECT * FROM sessions ORDER BY login_at DESC').all();
  const list = rows.map(s => ({
    token: s.token.slice(0, 8) + '...', // never expose the full usable token
    tokenFull: s.token,
    userId: s.user_id, name: s.name, role: s.role, loginAt: s.login_at,
  }));
  res.json(list);
});
router.delete('/sessions/:token', requireAuth('admin'), (req, res) => {
  destroySession(req.params.token);
  res.json({ ok: true });
});

module.exports = router;
