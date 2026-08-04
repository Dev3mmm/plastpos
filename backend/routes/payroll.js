const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { upload } = require('../middleware/upload');

const router = express.Router();

// Output is whatever that role physically produces - this is the basis for
// piece-rate pay. Cashier/admin aren't piece-rated by default (usually
// salaried), so they always show zero here.
function outputSince(userId, role, sinceISO) {
  if (role === 'input') {
    return db.prepare(`SELECT COALESCE(SUM(output_qty),0) as qty, COUNT(*) as count
      FROM material_conversions WHERE operator_id = ? AND created_at > ?`).get(userId, sinceISO);
  }
  if (role === 'cutting') {
    return db.prepare(`SELECT COALESCE(SUM(qty_produced),0) as qty, COUNT(*) as count
      FROM production_batches WHERE operator_id = ? AND produced_at > ?`).get(userId, sinceISO);
  }
  if (role === 'distribution') {
    return db.prepare(`SELECT COALESCE(SUM(qty),0) as qty, COUNT(*) as count
      FROM dispatches WHERE operator_id = ? AND dispatched_at > ?`).get(userId, sinceISO);
  }
  return { qty: 0, count: 0 };
}

function dailyOutput(userId, role, days) {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  let rows = [];
  if (role === 'input') {
    rows = db.prepare(`SELECT date(created_at) as day, SUM(output_qty) as qty
      FROM material_conversions WHERE operator_id = ? AND date(created_at) >= ? GROUP BY day`).all(userId, since);
  } else if (role === 'cutting') {
    rows = db.prepare(`SELECT date(produced_at) as day, SUM(qty_produced) as qty
      FROM production_batches WHERE operator_id = ? AND date(produced_at) >= ? GROUP BY day`).all(userId, since);
  } else if (role === 'distribution') {
    rows = db.prepare(`SELECT date(dispatched_at) as day, SUM(qty) as qty
      FROM dispatches WHERE operator_id = ? AND date(dispatched_at) >= ? GROUP BY day`).all(userId, since);
  }
  const byDay = {};
  rows.forEach(r => { byDay[r.day] = r.qty || 0; });
  const series = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    series.push({ day, qty: byDay[day] || 0 });
  }
  return series;
}

function lastPayment(userId) {
  return db.prepare(`SELECT * FROM payroll_payments WHERE user_id = ? ORDER BY paid_at DESC LIMIT 1`).get(userId);
}

function workerSummary(user) {
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const last = lastPayment(user.id);
  const since = last ? last.period_to : user.created_at;

  const todayOut = outputSince(user.id, user.role, today);
  const weekOut = outputSince(user.id, user.role, weekAgo);
  const unpaidOut = outputSince(user.id, user.role, since);
  const unpaidAmount = unpaidOut.qty * (user.piece_rate || 0);

  return {
    userId: user.id, name: user.name, role: user.role, piece_rate: user.piece_rate,
    today_qty: todayOut.qty, today_count: todayOut.count,
    week_qty: weekOut.qty,
    unpaid_since: since, unpaid_qty: unpaidOut.qty, unpaid_amount: unpaidAmount,
    last_payment: last || null,
    daily: dailyOutput(user.id, user.role, 7),
  };
}

// GET /api/payroll/summary - admin's view of every worker's output and pay owed
router.get('/summary', requireAuth('admin'), (req, res) => {
  const users = db.prepare(`SELECT * FROM users WHERE active = 1 AND role IN ('input','cutting','distribution')`).all();
  res.json(users.map(workerSummary));
});

// GET /api/payroll/me - a worker's own "am I paid" view
router.get('/me', requireAuth('input', 'cutting', 'distribution', 'cashier'), (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.userId);
  res.json(workerSummary(user));
});

// POST /api/payroll/pay/:userId - admin marks a worker paid for their
// unpaid period; amount defaults to output x piece_rate but can be overridden.
// An optional photo (e.g. an M-Pesa confirmation screenshot) becomes the
// worker's proof-of-payment, visible on their own dashboard.
router.post('/pay/:userId', requireAuth('admin'), upload.single('photo'), (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const last = lastPayment(user.id);
  const periodFrom = last ? last.period_to : user.created_at;
  const periodTo = new Date().toISOString();
  const output = outputSince(user.id, user.role, periodFrom);
  const amount = req.body.amount != null ? Number(req.body.amount) : output.qty * (user.piece_rate || 0);

  const run = db.transaction(() => {
    const info = db.prepare(`INSERT INTO payroll_payments
      (user_id, amount, output_qty, period_from, period_to, notes, photo_path, paid_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(user.id, amount, output.qty, periodFrom, periodTo, req.body.notes || '',
        req.file ? req.file.filename : null, req.user.userId);
    db.prepare(`INSERT INTO cash_transactions (type, category, amount, description, reference_id, recorded_by)
      VALUES ('out', 'wages', ?, ?, ?, ?)`)
      .run(amount, `Wages paid to ${user.name}`, info.lastInsertRowid, req.user.userId);
    return info.lastInsertRowid;
  });
  const id = run();
  res.json(db.prepare('SELECT * FROM payroll_payments WHERE id = ?').get(id));
});

// GET /api/payroll/history/:userId - admin, or the worker viewing their own history
router.get('/history/:userId', requireAuth('admin', 'input', 'cutting', 'distribution', 'cashier'), (req, res) => {
  if (req.user.role !== 'admin' && String(req.user.userId) !== String(req.params.userId)) {
    return res.status(403).json({ error: 'Not allowed' });
  }
  res.json(db.prepare(`SELECT * FROM payroll_payments WHERE user_id = ? ORDER BY paid_at DESC LIMIT 100`).all(req.params.userId));
});

// POST /api/payroll/dispute/:paymentId - a worker flags "I was marked paid
// but wasn't", so the admin can follow up (call them, resend proof, etc).
router.post('/dispute/:paymentId', requireAuth('input', 'cutting', 'distribution', 'cashier'), (req, res) => {
  const payment = db.prepare('SELECT * FROM payroll_payments WHERE id = ?').get(req.params.paymentId);
  if (!payment) return res.status(404).json({ error: 'Not found' });
  if (String(payment.user_id) !== String(req.user.userId)) return res.status(403).json({ error: 'Not your payment' });
  db.prepare(`UPDATE payroll_payments SET disputed = 1, dispute_note = ?, disputed_at = datetime('now'),
    resolved_at = NULL WHERE id = ?`).run(req.body.note || 'Marked paid but not received', req.params.paymentId);
  res.json(db.prepare('SELECT * FROM payroll_payments WHERE id = ?').get(req.params.paymentId));
});

// GET /api/payroll/disputes - admin's queue of "I wasn't paid" flags
router.get('/disputes', requireAuth('admin'), (req, res) => {
  res.json(db.prepare(`SELECT payroll_payments.*, users.name as user_name, users.role
    FROM payroll_payments JOIN users ON users.id = payroll_payments.user_id
    WHERE disputed = 1 AND resolved_at IS NULL ORDER BY disputed_at DESC`).all());
});

// PUT /api/payroll/resolve/:paymentId - admin closes out a dispute (after
// calling the worker, resending proof, correcting the amount, etc)
router.put('/resolve/:paymentId', requireAuth('admin'), (req, res) => {
  db.prepare(`UPDATE payroll_payments SET disputed = 0, resolved_at = datetime('now'), resolution_note = ?
    WHERE id = ?`).run(req.body.note || '', req.params.paymentId);
  res.json(db.prepare('SELECT * FROM payroll_payments WHERE id = ?').get(req.params.paymentId));
});

module.exports = router;
