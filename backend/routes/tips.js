const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Fully offline "AI tips" - no model, no network call. Reads the local data
// and applies straightforward rules. Cheap, instant, and never wrong in a
// way an LLM hallucination could be. See docs/AI_TIPS.md for how to upgrade
// this to a local LLM (Ollama) later without changing the API shape.
router.get('/', requireAuth('admin', 'cashier', 'production'), (req, res) => {
  const tips = [];

  const lowStockProducts = db.prepare(`SELECT * FROM products
    WHERE active = 1 AND stock_qty <= low_stock_threshold`).all();
  for (const p of lowStockProducts) {
    tips.push({
      level: 'warning',
      area: 'inventory',
      message: `${p.name} (${p.size}) is low on stock: ${p.stock_qty} left. Consider a production run soon.`,
    });
  }

  const lowMaterials = db.prepare(`SELECT * FROM raw_materials WHERE stock_qty <= low_stock_threshold`).all();
  for (const m of lowMaterials) {
    tips.push({
      level: 'warning',
      area: 'materials',
      message: `${m.name} is running low (${m.stock_qty}${m.unit} left). Order more before production stalls.`,
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
        message: `${t.name} (${t.size}) sales dropped ${drop}% vs last week (${t.last_week} -> ${t.this_week} units). Worth checking why.`,
      });
    }
    if (t.this_week >= t.last_week * 1.5 && t.this_week >= 5) {
      tips.push({
        level: 'info',
        area: 'sales',
        message: `${t.name} (${t.size}) is trending up this week (${t.last_week} -> ${t.this_week} units). Keep enough stock ready.`,
      });
    }
  }

  // Outstanding customer credit
  const credit = db.prepare(`SELECT COALESCE(SUM(balance),0) as total, COUNT(*) as n FROM customers WHERE balance > 0`).get();
  if (credit.total > 0) {
    tips.push({
      level: 'info',
      area: 'credit',
      message: `${credit.n} customer(s) owe a combined ${credit.total.toFixed(2)}. Follow up on the oldest balances first.`,
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
      message: `Recorded cash balance is negative (${cash.balance.toFixed(2)}). Check for missing expense/income entries.`,
    });
  }

  if (tips.length === 0) {
    tips.push({ level: 'info', area: 'general', message: 'No issues detected. Stock, sales and cash all look normal.' });
  }

  res.json({ generated_at: new Date().toISOString(), tips });
});

module.exports = router;
