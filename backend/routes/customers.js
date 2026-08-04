const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth('admin', 'cashier'), (req, res) => {
  res.json(db.prepare('SELECT * FROM customers ORDER BY name').all());
});

router.get('/:id', requireAuth('admin', 'cashier'), (req, res) => {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!customer) return res.status(404).json({ error: 'Not found' });
  const sales = db.prepare(`SELECT id, receipt_no, total_amount, amount_paid, status, sold_at
    FROM sales WHERE customer_id = ? ORDER BY sold_at DESC LIMIT 100`).all(req.params.id);
  res.json({ ...customer, sales });
});

router.post('/', requireAuth('admin', 'cashier'), (req, res) => {
  const { name, phone } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const info = db.prepare('INSERT INTO customers (name, phone) VALUES (?, ?)').run(name, phone || '');
  res.json(db.prepare('SELECT * FROM customers WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/:id', requireAuth('admin', 'cashier'), (req, res) => {
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const { name, phone } = req.body;
  db.prepare('UPDATE customers SET name=?, phone=? WHERE id=?').run(name ?? c.name, phone ?? c.phone, req.params.id);
  res.json(db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id));
});

// Record a payment against a customer's outstanding credit balance
router.post('/:id/payment', requireAuth('admin', 'cashier'), (req, res) => {
  const { amount } = req.body;
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  if (!amount || amount <= 0) return res.status(400).json({ error: 'positive amount is required' });

  const run = db.transaction(() => {
    db.prepare('UPDATE customers SET balance = balance - ? WHERE id = ?').run(amount, req.params.id);
    db.prepare(`INSERT INTO cash_transactions (type, category, amount, description, reference_id, recorded_by)
      VALUES ('in', 'customer_payment', ?, ?, ?, ?)`)
      .run(amount, `Payment from ${c.name}`, c.id, req.user.userId);
  });
  run();
  res.json(db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id));
});

module.exports = router;
