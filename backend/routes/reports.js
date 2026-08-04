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

router.get('/production-summary', requireAuth('admin', 'cutting'), (req, res) => {
  const { from, to } = range(req);
  const byProduct = db.prepare(`SELECT products.name, products.size,
      SUM(qty_produced) as qty_produced, SUM(material_cost) as material_cost
    FROM production_batches JOIN products ON products.id = production_batches.product_id
    WHERE produced_at BETWEEN ? AND ?
    GROUP BY products.id ORDER BY qty_produced DESC`).all(from, to);
  res.json({ from, to, byProduct });
});

// Day-by-day series for the dashboard charts: production, dispatches, sales
// revenue, an approximate cost-of-goods (qty sold x each product's set unit
// cost), manual expenses, and profit = revenue - cogs - expenses.
router.get('/daily', requireAuth('admin'), (req, res) => {
  const days = Math.min(Number(req.query.days) || 14, 90);
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const produced = db.prepare(`SELECT date(produced_at) as day, SUM(qty_produced) as qty
    FROM production_batches WHERE produced_at >= ? GROUP BY day`).all(since);
  const dispatched = db.prepare(`SELECT date(dispatched_at) as day, SUM(qty) as qty
    FROM dispatches WHERE dispatched_at >= ? GROUP BY day`).all(since);
  const revenue = db.prepare(`SELECT date(sold_at) as day, SUM(total_amount) as revenue
    FROM sales WHERE sold_at >= ? AND status != 'voided' GROUP BY day`).all(since);
  const cogs = db.prepare(`SELECT date(sales.sold_at) as day, SUM(sale_items.qty * products.unit_cost) as cogs
    FROM sale_items JOIN sales ON sales.id = sale_items.sale_id JOIN products ON products.id = sale_items.product_id
    WHERE sales.sold_at >= ? AND sales.status != 'voided' GROUP BY day`).all(since);
  const expenses = db.prepare(`SELECT date(recorded_at) as day, SUM(amount) as expenses
    FROM cash_transactions WHERE recorded_at >= ? AND type = 'out' AND category = 'expense' GROUP BY day`).all(since);

  const byDay = {};
  const ensure = (day) => byDay[day] || (byDay[day] = { day, produced: 0, dispatched: 0, revenue: 0, cogs: 0, expenses: 0 });
  produced.forEach(r => { ensure(r.day).produced = r.qty || 0; });
  dispatched.forEach(r => { ensure(r.day).dispatched = r.qty || 0; });
  revenue.forEach(r => { ensure(r.day).revenue = r.revenue || 0; });
  cogs.forEach(r => { ensure(r.day).cogs = r.cogs || 0; });
  expenses.forEach(r => { ensure(r.day).expenses = r.expenses || 0; });

  const series = Object.values(byDay)
    .map(d => ({ ...d, profit: d.revenue - d.cogs - d.expenses }))
    .sort((a, b) => a.day.localeCompare(b.day));

  res.json({ days, series });
});

router.get('/stock-levels', requireAuth('admin', 'cutting', 'cashier', 'input', 'distribution'), (req, res) => {
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
