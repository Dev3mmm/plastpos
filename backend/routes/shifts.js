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

// GET /api/shifts/today - admin oversight: who's clocked in right now, and today's log
router.get('/today', requireAuth('admin'), (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const rows = db.prepare(`SELECT shift_logs.*, users.name, users.role
    FROM shift_logs JOIN users ON users.id = shift_logs.user_id
    WHERE date(shift_logs.clock_in) = ? ORDER BY shift_logs.clock_in DESC`).all(today);
  res.json(rows);
});

module.exports = router;
