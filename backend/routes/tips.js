const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Fully offline "AI tips" - no model, no network call. Reads the local data
// and applies straightforward rules. Cheap, instant, and never wrong in a
// way an LLM hallucination could be. See docs/AI_TIPS.md for how to upgrade
// this to a local LLM (Ollama) later without changing the API shape.
router.get('/', requireAuth('admin', 'cashier', 'input', 'cutting', 'distribution'), (req, res) => {
  const tips = [];
  const role = req.user.role;

  // Daily rollover: called out first and loudly, so a section that did
  // nothing yesterday can't quietly slide into today's report unnoticed.
  if (role === 'admin') {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const stageChecks = [
      { label: 'Plant Operator', table: 'material_conversions', col: 'created_at' },
      { label: 'Packaging', table: 'production_batches', col: 'produced_at' },
      { label: 'Picking', table: 'dispatches', col: 'dispatched_at' },
    ];
    for (const s of stageChecks) {
      const row = db.prepare(`SELECT COUNT(*) as n FROM ${s.table} WHERE date(${s.col}) = ?`).get(yesterday);
      if (row.n === 0) {
        tips.push({ level: 'warning', area: 'rollover', message: `Yesterday (${yesterday}): ${s.label} did not log any work. Ask why before today's numbers pile on top.` });
      }
    }
  }

  // Orders waiting on stock that isn't there yet - shown to the people who
  // can actually fix it (Packaging, Plant Operator) as well as admin.
  if (['admin', 'cutting', 'input'].includes(role)) {
    const shortOrders = db.prepare(`SELECT orders.id, orders.qty, customers.name as customer_name,
        products.name as product_name, products.size, products.stock_qty
      FROM orders
      JOIN customers ON customers.id = orders.customer_id
      JOIN products ON products.id = orders.product_id
      WHERE orders.status = 'pending' AND products.stock_qty < orders.qty`).all();
    for (const o of shortOrders) {
      const short = o.qty - o.stock_qty;
      tips.push({
        level: 'warning',
        area: 'orders',
        message: `Order for ${esc(o.customer_name)}: needs ${o.qty} x ${esc(o.product_name)} (${esc(o.size)}), only ${o.stock_qty} in stock. Make ${short} more to fill this order.`,
      });
    }
  }

  const lowStockProducts = db.prepare(`SELECT * FROM products
    WHERE active = 1 AND stock_qty <= low_stock_threshold`).all();
  for (const p of lowStockProducts) {
    tips.push({
      level: 'warning',
      area: 'inventory',
      message: `${p.name} (${p.size}) is running low: only ${p.stock_qty} left. Make more soon.`,
    });
  }

  const lowMaterials = db.prepare(`SELECT * FROM raw_materials WHERE stock_qty <= low_stock_threshold`).all();
  for (const m of lowMaterials) {
    tips.push({
      level: 'warning',
      area: 'materials',
      message: `${m.name} is running low: only ${m.stock_qty}${m.unit} left. Buy more soon or work will stop.`,
    });
  }

  // Sales trend: this week vs last week, per product
  const trend = db.prepare(`
    SELECT products.id, products.name, products.size,
      SUM(CASE WHEN sales.sold_at >= datetime('now','-7 days') THEN sale_items.qty ELSE 0 END) as this_week,
      SUM(CASE WHEN sales.sold_at >= datetime('now','-14 days') AND sales.sold_at < datetime('now','-7 days')
        THEN sale_items.qty ELSE 0 END) as last_week
    FROM sale_items
    JOIN sales ON sales.id = sale_items.sale_id AND sales.status != 'voided'
    JOIN products ON products.id = sale_items.product_id
    GROUP BY products.id`).all();
  for (const t of trend) {
    if (t.last_week >= 5 && t.this_week < t.last_week * 0.6) {
      const drop = Math.round((1 - t.this_week / t.last_week) * 100);
      tips.push({
        level: 'info',
        area: 'sales',
        message: `${t.name} (${t.size}) sold ${drop}% less this week than last week (${t.last_week} -> ${t.this_week}). Worth checking why.`,
      });
    }
    if (t.this_week >= t.last_week * 1.5 && t.this_week >= 5) {
      tips.push({
        level: 'info',
        area: 'sales',
        message: `${t.name} (${t.size}) is selling more this week (${t.last_week} -> ${t.this_week}). Keep enough in stock.`,
      });
    }
  }

  // Outstanding customer credit
  const credit = db.prepare(`SELECT COALESCE(SUM(balance),0) as total, COUNT(*) as n FROM customers WHERE balance > 0`).get();
  if (credit.total > 0) {
    tips.push({
      level: 'info',
      area: 'credit',
      message: `${credit.n} customer(s) owe a total of ${credit.total.toFixed(2)}. Ask them to pay, oldest first.`,
    });
  }

  // Cash position sanity check
  const cash = db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN type='in' THEN amount ELSE 0 END),0) -
      COALESCE(SUM(CASE WHEN type='out' THEN amount ELSE 0 END),0) as balance
    FROM cash_transactions`).get();
  if (cash.balance < 0) {
    tips.push({
      level: 'warning',
      area: 'cash',
      message: `Cash balance is negative (${cash.balance.toFixed(2)}). Some money in or out may be missing - check the Cash Book.`,
    });
  }

  if (tips.length === 0) {
    tips.push({ level: 'info', area: 'general', message: 'Nothing needs attention right now. Stock, sales and cash all look fine.' });
  }

  res.json({ generated_at: new Date().toISOString(), tips });
});

function esc(s) { return String(s ?? ''); }

module.exports = router;
