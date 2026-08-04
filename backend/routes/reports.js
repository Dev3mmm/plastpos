const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function range(req) {
  const to = req.query.to || new Date().toISOString();
  const from = req.query.from || new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  return { from, to };
}

router.get('/sales-summary', requireAuth('admin'), (req, res) => {
  const { from, to } = range(req);
  const totals = db.prepare(`SELECT COUNT(*) as sale_count,
      COALESCE(SUM(total_amount), 0) as revenue,
      COALESCE(SUM(amount_paid), 0) as collected
    FROM sales WHERE sold_at BETWEEN ? AND ? AND status != 'voided'`).get(from, to);
  const byProduct = db.prepare(`SELECT products.name, products.size,
      SUM(sale_items.qty) as qty_sold, SUM(sale_items.subtotal) as revenue
    FROM sale_items
    JOIN sales ON sales.id = sale_items.sale_id
    JOIN products ON products.id = sale_items.product_id
    WHERE sales.sold_at BETWEEN ? AND ? AND sales.status != 'voided'
    GROUP BY products.id ORDER BY revenue DESC`).all(from, to);
  const byDay = db.prepare(`SELECT date(sold_at) as day, SUM(total_amount) as revenue, COUNT(*) as sale_count
    FROM sales WHERE sold_at BETWEEN ? AND ? AND status != 'voided'
    GROUP BY day ORDER BY day`).all(from, to);
  res.json({ from, to, totals, byProduct, byDay });
});

router.get('/production-summary', requireAuth('admin', 'production'), (req, res) => {
  const { from, to } = range(req);
  const byProduct = db.prepare(`SELECT products.name, products.size,
      SUM(qty_produced) as qty_produced, SUM(material_cost) as material_cost
    FROM production_batches JOIN products ON products.id = production_batches.product_id
    WHERE produced_at BETWEEN ? AND ?
    GROUP BY products.id ORDER BY qty_produced DESC`).all(from, to);
  res.json({ from, to, byProduct });
});

router.get('/stock-levels', requireAuth('admin', 'production', 'cashier'), (req, res) => {
  const products = db.prepare('SELECT id, name, size, stock_qty, low_stock_threshold, unit_price FROM products WHERE active = 1').all();
  const materials = db.prepare('SELECT id, name, unit, stock_qty, low_stock_threshold, avg_cost FROM raw_materials').all();
  res.json({ products, materials });
});

router.get('/cashflow', requireAuth('admin'), (req, res) => {
  const { from, to } = range(req);
  const byCategory = db.prepare(`SELECT type, category, SUM(amount) as total
    FROM cash_transactions WHERE recorded_at BETWEEN ? AND ?
    GROUP BY type, category ORDER BY type, total DESC`).all(from, to);
  const byDay = db.prepare(`SELECT date(recorded_at) as day,
      SUM(CASE WHEN type='in' THEN amount ELSE 0 END) as cash_in,
      SUM(CASE WHEN type='out' THEN amount ELSE 0 END) as cash_out
    FROM cash_transactions WHERE recorded_at BETWEEN ? AND ? GROUP BY day ORDER BY day`).all(from, to);
  res.json({ from, to, byCategory, byDay });
});

router.get('/top-customers', requireAuth('admin'), (req, res) => {
  const { from, to } = range(req);
  const rows = db.prepare(`SELECT customers.id, customers.name, customers.balance,
      COUNT(sales.id) as sale_count, SUM(sales.total_amount) as revenue
    FROM sales JOIN customers ON customers.id = sales.customer_id
    WHERE sold_at BETWEEN ? AND ? AND sales.status != 'voided'
    GROUP BY customers.id ORDER BY revenue DESC LIMIT 20`).all(from, to);
  res.json(rows);
});

router.get('/outstanding-credit', requireAuth('admin'), (req, res) => {
  res.json(db.prepare(`SELECT id, name, phone, balance FROM customers WHERE balance > 0 ORDER BY balance DESC`).all());
});

module.exports = router;
