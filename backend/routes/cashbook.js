const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth('admin'), (req, res) => {
  const { from, to, type, category } = req.query;
  let sql = `SELECT cash_transactions.*, users.name as recorded_by_name
    FROM cash_transactions LEFT JOIN users ON users.id = cash_transactions.recorded_by WHERE 1=1`;
  const params = [];
  if (from) { sql += ' AND recorded_at >= ?'; params.push(from); }
  if (to) { sql += ' AND recorded_at <= ?'; params.push(to); }
  if (type) { sql += ' AND type = ?'; params.push(type); }
  if (category) { sql += ' AND category = ?'; params.push(category); }
  sql += ' ORDER BY recorded_at DESC LIMIT 500';
  res.json(db.prepare(sql).all(...params));
});

// Manual entries - e.g. rent, wages, fuel, transport. Sales/purchases/customer
// payments post here automatically from their own routes.
router.post('/expense', requireAuth('admin'), (req, res) => {
  const { amount, description, category } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'positive amount is required' });
  const info = db.prepare(`INSERT INTO cash_transactions (type, category, amount, description, recorded_by)
    VALUES ('out', ?, ?, ?, ?)`).run(category || 'expense', amount, description || '', req.user.userId);
  res.json(db.prepare('SELECT * FROM cash_transactions WHERE id = ?').get(info.lastInsertRowid));
});

router.post('/income', requireAuth('admin'), (req, res) => {
  const { amount, description, category } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'positive amount is required' });
  const info = db.prepare(`INSERT INTO cash_transactions (type, category, amount, description, recorded_by)
    VALUES ('in', ?, ?, ?, ?)`).run(category || 'other', amount, description || '', req.user.userId);
  res.json(db.prepare('SELECT * FROM cash_transactions WHERE id = ?').get(info.lastInsertRowid));
});

// Running cash-in-hand balance plus a same-day summary for closing out the till
router.get('/summary', requireAuth('admin'), (req, res) => {
  const totals = db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN type='in' THEN amount ELSE 0 END), 0) as total_in,
      COALESCE(SUM(CASE WHEN type='out' THEN amount ELSE 0 END), 0) as total_out
    FROM cash_transactions`).get();
  const today = new Date().toISOString().slice(0, 10);
  const todayTotals = db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN type='in' THEN amount ELSE 0 END), 0) as today_in,
      COALESCE(SUM(CASE WHEN type='out' THEN amount ELSE 0 END), 0) as today_out
    FROM cash_transactions WHERE recorded_at >= ?`).get(today);
  res.json({
    cash_in_hand: totals.total_in - totals.total_out,
    ...totals,
    ...todayTotals,
  });
});

module.exports = router;
