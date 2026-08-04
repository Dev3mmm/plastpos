const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const WORKER_ROLES = ['input', 'cutting', 'picking', 'distribution', 'cashier'];

const SHIFT_HOURS = 12;

function openShift(userId) {
  return db.prepare(`SELECT * FROM shift_logs WHERE user_id = ? AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1`).get(userId);
}

// A shift that's run past its 12 hours closes itself, using this server's
// own clock (not something admin sets by hand) - so nobody can just leave
// the clock running. Runs before anything that reads/changes shift state.
function autoCloseStale(userId) {
  db.prepare(`UPDATE shift_logs SET clock_out = datetime(clock_in, '+${SHIFT_HOURS} hours')
    WHERE user_id = ? AND clock_out IS NULL AND clock_in <= datetime('now', '-${SHIFT_HOURS} hours')`).run(userId);
}
function autoCloseStaleAll() {
  db.prepare(`UPDATE shift_logs SET clock_out = datetime(clock_in, '+${SHIFT_HOURS} hours')
    WHERE clock_out IS NULL AND clock_in <= datetime('now', '-${SHIFT_HOURS} hours')`).run();
}

// GET /api/shifts/status - am I clocked in right now, and my schedule
router.get('/status', requireAuth(...WORKER_ROLES), (req, res) => {
  autoCloseStale(req.user.userId);
  const user = db.prepare('SELECT shift_start, shift_end FROM users WHERE id = ?').get(req.user.userId);
  const open = openShift(req.user.userId);
  const today = new Date().toISOString().slice(0, 10);
  const todayLogs = db.prepare(`SELECT * FROM shift_logs WHERE user_id = ? AND date(clock_in) = ? ORDER BY clock_in`).all(req.user.userId, today);
  res.json({ clockedIn: !!open, current: open || null, today: todayLogs, shift_start: user.shift_start, shift_end: user.shift_end });
});

// PUT /api/shifts/schedule - each worker sets their OWN alarm time. Admin
// can still set it for them from Settings, but doesn't have to - whichever
// was saved most recently wins, same field either way.
router.put('/schedule', requireAuth(...WORKER_ROLES), (req, res) => {
  const { shift_start, shift_end } = req.body;
  db.prepare('UPDATE users SET shift_start = ?, shift_end = ? WHERE id = ?')
    .run(shift_start || null, shift_end || null, req.user.userId);
  res.json({ shift_start: shift_start || null, shift_end: shift_end || null });
});

// One shift per 12-hour window - stops someone clocking in/out repeatedly
// within the same shift to fake extra shifts worked for pay.
router.post('/clock-in', requireAuth(...WORKER_ROLES), (req, res) => {
  autoCloseStale(req.user.userId);
  if (openShift(req.user.userId)) return res.status(400).json({ error: 'Already clocked in' });
  const recent = db.prepare(`SELECT * FROM shift_logs WHERE user_id = ?
    AND clock_in > datetime('now', '-${SHIFT_HOURS} hours') ORDER BY clock_in DESC LIMIT 1`).get(req.user.userId);
  if (recent) {
    return res.status(400).json({ error: `You already had a shift starting at ${recent.clock_in}. Only one shift per ${SHIFT_HOURS} hours is allowed.` });
  }
  const info = db.prepare('INSERT INTO shift_logs (user_id) VALUES (?)').run(req.user.userId);
  res.json(db.prepare('SELECT * FROM shift_logs WHERE id = ?').get(info.lastInsertRowid));
});

router.post('/clock-out', requireAuth(...WORKER_ROLES), (req, res) => {
  autoCloseStale(req.user.userId);
  const open = openShift(req.user.userId);
  if (!open) return res.status(400).json({ error: 'Not clocked in' });
  db.prepare(`UPDATE shift_logs SET clock_out = datetime('now') WHERE id = ?`).run(open.id);
  res.json(db.prepare('SELECT * FROM shift_logs WHERE id = ?').get(open.id));
});

function workLoggedToday(userId, role, today) {
  if (role === 'input') return db.prepare(`SELECT COUNT(*) as n FROM material_conversions WHERE operator_id = ? AND date(created_at) = ?`).get(userId, today).n > 0;
  if (role === 'cutting') return db.prepare(`SELECT COUNT(*) as n FROM production_batches WHERE operator_id = ? AND date(produced_at) = ?`).get(userId, today).n > 0;
  if (role === 'picking') return db.prepare(`SELECT COUNT(*) as n FROM picking_logs WHERE operator_id = ? AND date(created_at) = ?`).get(userId, today).n > 0;
  if (role === 'distribution') return db.prepare(`SELECT COUNT(*) as n FROM dispatches WHERE operator_id = ? AND date(dispatched_at) = ?`).get(userId, today).n > 0;
  if (role === 'cashier') return db.prepare(`SELECT COUNT(*) as n FROM sales WHERE cashier_id = ? AND date(sold_at) = ?`).get(userId, today).n > 0;
  return true;
}

// GET /api/shifts/today - admin oversight: who's clocked in right now, and
// today's log - flags anyone who clocked in but hasn't actually logged any
// work yet, so attendance and output can be checked against each other.
router.get('/today', requireAuth('admin'), (req, res) => {
  autoCloseStaleAll();
  const today = new Date().toISOString().slice(0, 10);
  const rows = db.prepare(`SELECT shift_logs.*, users.name, users.role
    FROM shift_logs JOIN users ON users.id = shift_logs.user_id
    WHERE date(shift_logs.clock_in) = ? ORDER BY shift_logs.clock_in DESC`).all(today);
  res.json(rows.map(r => ({ ...r, worked: workLoggedToday(r.user_id, r.role, today) })));
});

module.exports = router;
