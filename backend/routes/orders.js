const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const ALL_ROLES = ['admin', 'cashier', 'input', 'cutting', 'distribution'];

// A customer order is a request, not a sale - no money changes hands here.
// Picking closes it out by logging a delivery (see stages.js dispatch,
// order_id field), which marks it fulfilled automatically.
router.get('/', requireAuth(...ALL_ROLES), (req, res) => {
  const { status } = req.query;
  let sql = `SELECT orders.*, customers.name as customer_name, customers.phone as customer_phone,
      products.name as product_name, products.size, products.stock_qty as product_stock
    FROM orders
    JOIN customers ON customers.id = orders.customer_id
    JOIN products ON products.id = orders.product_id
    WHERE 1=1`;
  const params = [];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY orders.created_at DESC LIMIT 200';
  res.json(db.prepare(sql).all(...params));
});

router.post('/', requireAuth('admin', 'cashier'), (req, res) => {
  const { customer_id, product_id, qty, notes } = req.body;
  const q = Number(qty);
  if (!customer_id || !product_id || !q || q <= 0) {
    return res.status(400).json({ error: 'customer, product and a positive qty are required' });
  }
  const info = db.prepare(`INSERT INTO orders (customer_id, product_id, qty, notes, created_by)
    VALUES (?, ?, ?, ?, ?)`).run(customer_id, product_id, q, notes || '', req.user.userId);
  res.json(db.prepare(`SELECT orders.*, customers.name as customer_name, products.name as product_name
    FROM orders JOIN customers ON customers.id = orders.customer_id
    JOIN products ON products.id = orders.product_id WHERE orders.id = ?`).get(info.lastInsertRowid));
});

router.put('/:id/cancel', requireAuth('admin'), (req, res) => {
  db.prepare(`UPDATE orders SET status = 'cancelled' WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
