const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const WORKER_ROLES = ['input', 'cutting', 'distribution', 'cashier'];

function openShift(userId) {
  return db.prepare(`SELECT * FROM shift_logs WHERE user_id = ? AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1`).get(userId);
}

// GET /api/shifts/status - am I clocked in right now, and my schedule
router.get('/status', requireAuth(...WORKER_ROLES), (req, res) => {
  const user = db.prepare('SELECT shift_start, shift_end FROM users WHERE id = ?').get(req.user.userId);
  const open = openShift(req.user.userId);
  const today = new Date().toISOString().slice(0, 10);
  const todayLogs = db.prepare(`SELECT * FROM shift_logs WHERE user_id = ? AND date(clock_in) = ? ORDER BY clock_in`).all(req.user.userId, today);
  res.json({ clockedIn: !!open, current: open || null, today: todayLogs, shift_start: user.shift_start, shift_end: user.shift_end });
});

router.post('/clock-in', requireAuth(...WORKER_ROLES), (req, res) => {
  if (openShift(req.user.userId)) return res.status(400).json({ error: 'Already clocked in' });
  const info = db.prepare('INSERT INTO shift_logs (user_id) VALUES (?)').run(req.user.userId);
  res.json(db.prepare('SELECT * FROM shift_logs WHERE id = ?').get(info.lastInsertRowid));
});

router.post('/clock-out', requireAuth(...WORKER_ROLES), (req, res) => {
  const open = openShift(req.user.userId);
  if (!open) return res.status(400).json({ error: 'Not clocked in' });
  db.prepare(`UPDATE shift_logs SET clock_out = datetime('now') WHERE id = ?`).run(open.id);
  res.json(db.prepare('SELECT * FROM shift_logs WHERE id = ?').get(open.id));
});

function workLoggedToday(userId, role, today) {
  if (role === 'input') return db.prepare(`SELECT COUNT(*) as n FROM material_conversions WHERE operator_id = ? AND date(created_at) = ?`).get(userId, today).n > 0;
  if (role === 'cutting') return db.prepare(`SELECT COUNT(*) as n FROM production_batches WHERE operator_id = ? AND date(produced_at) = ?`).get(userId, today).n > 0;
  if (role === 'distribution') return db.prepare(`SELECT COUNT(*) as n FROM dispatches WHERE operator_id = ? AND date(dispatched_at) = ?`).get(userId, today).n > 0;
  if (role === 'cashier') return db.prepare(`SELECT COUNT(*) as n FROM sales WHERE cashier_id = ? AND date(sold_at) = ?`).get(userId, today).n > 0;
  return true;
}

// GET /api/shifts/today - admin oversight: who's clocked in right now, and
// today's log - flags anyone who clocked in but hasn't actually logged any
// work yet, so attendance and output can be checked against each other.
router.get('/today', requireAuth('admin'), (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const rows = db.prepare(`SELECT shift_logs.*, users.name, users.role
    FROM shift_logs JOIN users ON users.id = shift_logs.user_id
    WHERE date(shift_logs.clock_in) = ? ORDER BY shift_logs.clock_in DESC`).all(today);
  res.json(rows.map(r => ({ ...r, worked: workLoggedToday(r.user_id, r.role, today) })));
});

module.exports = router;
