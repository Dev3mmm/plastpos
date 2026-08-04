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
  setSetting.run('welcome_tagline', 'JITUME MZEE... MUKUCHU NDIO FORM ... To God be the glory');

  const pinHash = bcrypt.hashSync(String(adminPin), 8);
  const info = db.prepare(`INSERT INTO users (name, pin_hash, role, first_login_at) VALUES (?, ?, 'admin', datetime('now'))`)
    .run(adminName, pinHash);

  const user = { id: info.lastInsertRowid, name: adminName, role: 'admin' };
  const token = createSession(user);
  res.json({ token, user, firstLogin: true });
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
  const allowed = ['business_name', 'industry', 'address', 'phone', 'currency', 'electricity_rate_per_kwh', 'welcome_tagline'];
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
  const firstLogin = !user.first_login_at;
  if (firstLogin) {
    db.prepare(`UPDATE users SET first_login_at = datetime('now') WHERE id = ?`).run(user.id);
  }
  const token = createSession(user);
  res.json({ token, user: { id: user.id, name: user.name, role: user.role }, firstLogin });
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

// ---- "I forgot my PIN" - a pre-login ping to admin, since there's no
// email/SMS here to send a reset link ----
router.post('/request-pin-reset', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(req.body.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const existing = db.prepare('SELECT * FROM pin_reset_requests WHERE user_id = ? AND resolved_at IS NULL').get(user.id);
  if (existing) return res.json({ ok: true, alreadySent: true });
  db.prepare('INSERT INTO pin_reset_requests (user_id) VALUES (?)').run(user.id);
  res.json({ ok: true });
});

router.get('/pin-reset-requests', requireAuth('admin'), (req, res) => {
  res.json(db.prepare(`SELECT pin_reset_requests.*, users.name, users.role FROM pin_reset_requests
    JOIN users ON users.id = pin_reset_requests.user_id
    WHERE resolved_at IS NULL ORDER BY requested_at DESC`).all());
});

// PUT /api/auth/users/:id/reset-pin - admin sets a new PIN for someone who's
// locked out, and closes out any pending "forgot PIN" request for them.
router.put('/users/:id/reset-pin', requireAuth('admin'), (req, res) => {
  const pin = String(req.body.pin || '');
  if (!pin) return res.status(400).json({ error: 'pin is required' });
  const pinHash = bcrypt.hashSync(pin, 8);
  db.prepare('UPDATE users SET pin_hash = ? WHERE id = ?').run(pinHash, req.params.id);
  db.prepare(`UPDATE pin_reset_requests SET resolved_at = datetime('now'), resolved_by = ?
    WHERE user_id = ? AND resolved_at IS NULL`).run(req.user.userId, req.params.id);
  res.json({ ok: true });
});

// POST /api/auth/users - admin creates a staff account, one per role/section.
// piece_rate is pay per unit of that role's output (KES per kg of rolls,
// per bag cut, per packet dispatched) - 0 means salaried / not piece-rated.
// If no PIN is typed, one is made up automatically (simple 4 digits) and
// sent back in plain text this one time only, so admin can share it with
// the new worker - it can never be read back after this response.
router.post('/users', requireAuth('admin'), (req, res) => {
  const { name, role } = req.body;
  let pin = req.body.pin;
  if (!name || !VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: `name and a valid role (${VALID_ROLES.join(', ')}) are required` });
  }
  if (!pin) pin = String(Math.floor(1000 + Math.random() * 9000));
  const piece_rate = req.body.piece_rate;
  const pinHash = bcrypt.hashSync(String(pin), 8);
  const info = db.prepare('INSERT INTO users (name, pin_hash, role, piece_rate) VALUES (?, ?, ?, ?)')
    .run(name, pinHash, role, Number(piece_rate) || 0);
  res.json({ id: info.lastInsertRowid, name, role, piece_rate: Number(piece_rate) || 0, pin });
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
