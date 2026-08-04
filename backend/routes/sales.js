const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { logMovement } = require('./inventory');

const router = express.Router();

function nextReceiptNo() {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'receipt_counter'`).get();
  const next = (row ? parseInt(row.value, 10) : 0) + 1;
  db.prepare(`INSERT INTO settings (key, value) VALUES ('receipt_counter', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(String(next));
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `RCT-${datePart}-${String(next).padStart(5, '0')}`;
}

router.get('/', requireAuth('admin', 'cashier'), (req, res) => {
  const { from, to } = req.query;
  let sql = `SELECT sales.*, customers.name as customer_name, users.name as cashier_name
    FROM sales
    LEFT JOIN customers ON customers.id = sales.customer_id
    LEFT JOIN users ON users.id = sales.cashier_id
    WHERE 1=1`;
  const params = [];
  if (from) { sql += ' AND sold_at >= ?'; params.push(from); }
  if (to) { sql += ' AND sold_at <= ?'; params.push(to); }
  sql += ' ORDER BY sold_at DESC LIMIT 500';
  res.json(db.prepare(sql).all(...params));
});

router.get('/:id', requireAuth('admin', 'cashier'), (req, res) => {
  const sale = db.prepare(`SELECT sales.*, customers.name as customer_name, customers.phone as customer_phone,
    users.name as cashier_name FROM sales
    LEFT JOIN customers ON customers.id = sales.customer_id
    LEFT JOIN users ON users.id = sales.cashier_id
    WHERE sales.id = ?`).get(req.params.id);
  if (!sale) return res.status(404).json({ error: 'Not found' });
  const items = db.prepare(`SELECT sale_items.*, products.name as product_name, products.size
    FROM sale_items JOIN products ON products.id = sale_items.product_id
    WHERE sale_id = ?`).all(req.params.id);
  res.json({ ...sale, items });
});

// POST /api/sales - the actual POS "checkout" action
// body: { items: [{product_id, qty}], customer_id?, amount_paid, payment_method }
router.post('/', requireAuth('admin', 'cashier'), (req, res) => {
  const { items, customer_id, amount_paid, payment_method } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'At least one item is required' });
  }

  const run = db.transaction(() => {
    let total = 0;
    const lines = [];
    for (const item of items) {
      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(item.product_id);
      if (!product) throw new Error(`Product ${item.product_id} not found`);
      if (product.stock_qty < item.qty) throw new Error(`Not enough stock of ${product.name}`);
      const subtotal = product.unit_price * item.qty;
      total += subtotal;
      lines.push({ product, qty: item.qty, unit_price: product.unit_price, subtotal });
    }

    const paid = amount_paid != null ? amount_paid : total;
    const method = payment_method || 'cash';
    const status = paid < total ? 'credit' : 'completed';
    const receiptNo = nextReceiptNo();

    const saleInfo = db.prepare(`INSERT INTO sales
      (receipt_no, customer_id, total_amount, amount_paid, payment_method, status, cashier_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(receiptNo, customer_id || null, total, paid, method, status, req.user.userId);
    const saleId = saleInfo.lastInsertRowid;

    for (const line of lines) {
      db.prepare(`INSERT INTO sale_items (sale_id, product_id, qty, unit_price, subtotal)
        VALUES (?, ?, ?, ?, ?)`).run(saleId, line.product.id, line.qty, line.unit_price, line.subtotal);
      db.prepare('UPDATE products SET stock_qty = stock_qty - ? WHERE id = ?').run(line.qty, line.product.id);
      logMovement('product', line.product.id, -line.qty, 'sale', saleId);
    }

    db.prepare(`INSERT INTO cash_transactions (type, category, amount, description, reference_id, recorded_by)
      VALUES ('in', 'sale', ?, ?, ?, ?)`).run(paid, `Sale ${receiptNo}`, saleId, req.user.userId);

    if (customer_id && paid < total) {
      db.prepare('UPDATE customers SET balance = balance + ? WHERE id = ?').run(total - paid, customer_id);
    }

    return saleId;
  });

  let saleId;
  try {
    saleId = run();
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const sale = db.prepare(`SELECT sales.*, customers.name as customer_name FROM sales
    LEFT JOIN customers ON customers.id = sales.customer_id WHERE sales.id = ?`).get(saleId);
  const items2 = db.prepare(`SELECT sale_items.*, products.name as product_name, products.size
    FROM sale_items JOIN products ON products.id = sale_items.product_id WHERE sale_id = ?`).all(saleId);
  res.json({ ...sale, items: items2 });
});

// POST /api/sales/:id/void - admin-only, reverses stock and cash effects
router.post('/:id/void', requireAuth('admin'), (req, res) => {
  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(req.params.id);
  if (!sale) return res.status(404).json({ error: 'Not found' });
  if (sale.status === 'voided') return res.status(400).json({ error: 'Already voided' });

  const run = db.transaction(() => {
    const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(sale.id);
    for (const item of items) {
      db.prepare('UPDATE products SET stock_qty = stock_qty + ? WHERE id = ?').run(item.qty, item.product_id);
      logMovement('product', item.product_id, item.qty, 'void', sale.id);
    }
    db.prepare(`INSERT INTO cash_transactions (type, category, amount, description, reference_id, recorded_by)
      VALUES ('out', 'sale', ?, ?, ?, ?)`)
      .run(sale.amount_paid, `Void ${sale.receipt_no}`, sale.id, req.user.userId);
    if (sale.customer_id && sale.amount_paid < sale.total_amount) {
      db.prepare('UPDATE customers SET balance = balance - ? WHERE id = ?')
        .run(sale.total_amount - sale.amount_paid, sale.customer_id);
    }
    db.prepare(`UPDATE sales SET status = 'voided' WHERE id = ?`).run(sale.id);
  });
  run();
  res.json({ ok: true });
});

module.exports = router;
