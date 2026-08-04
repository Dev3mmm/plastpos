const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { logMovement } = require('./inventory');

const router = express.Router();

// ---- Suppliers ----

router.get('/suppliers', requireAuth('admin'), (req, res) => {
  res.json(db.prepare('SELECT * FROM suppliers ORDER BY name').all());
});

router.post('/suppliers', requireAuth('admin'), (req, res) => {
  const { name, phone, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const info = db.prepare('INSERT INTO suppliers (name, phone, notes) VALUES (?, ?, ?)')
    .run(name, phone || '', notes || '');
  res.json(db.prepare('SELECT * FROM suppliers WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/suppliers/:id', requireAuth('admin'), (req, res) => {
  const s = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  const { name, phone, notes } = req.body;
  db.prepare('UPDATE suppliers SET name=?, phone=?, notes=? WHERE id=?')
    .run(name ?? s.name, phone ?? s.phone, notes ?? s.notes, req.params.id);
  res.json(db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id));
});

// ---- Purchases (raw material intake) ----

router.get('/', requireAuth('admin'), (req, res) => {
  const { from, to } = req.query;
  let sql = `SELECT purchases.*, suppliers.name as supplier_name, raw_materials.name as material_name,
    raw_materials.unit FROM purchases
    LEFT JOIN suppliers ON suppliers.id = purchases.supplier_id
    JOIN raw_materials ON raw_materials.id = purchases.material_id
    WHERE 1=1`;
  const params = [];
  if (from) { sql += ' AND purchase_date >= ?'; params.push(from); }
  if (to) { sql += ' AND purchase_date <= ?'; params.push(to); }
  sql += ' ORDER BY purchase_date DESC LIMIT 500';
  res.json(db.prepare(sql).all(...params));
});

// Recording an intake bumps raw material stock and recalculates its
// running average cost, so production batches price themselves correctly.
router.post('/', requireAuth('admin'), (req, res) => {
  const { supplier_id, material_id, qty, unit_cost, paid_amount } = req.body;
  if (!material_id || !qty || qty <= 0 || unit_cost == null) {
    return res.status(400).json({ error: 'material_id, positive qty and unit_cost are required' });
  }
  const material = db.prepare('SELECT * FROM raw_materials WHERE id = ?').get(material_id);
  if (!material) return res.status(404).json({ error: 'Material not found' });

  const totalCost = qty * unit_cost;
  const paid = paid_amount != null ? paid_amount : totalCost;

  const run = db.transaction(() => {
    const info = db.prepare(`INSERT INTO purchases
      (supplier_id, material_id, qty, unit_cost, total_cost, paid_amount, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(supplier_id || null, material_id, qty, unit_cost, totalCost, paid, req.user.userId);

    const newStock = material.stock_qty + qty;
    const newAvgCost = newStock > 0
      ? ((material.stock_qty * material.avg_cost) + totalCost) / newStock
      : unit_cost;
    db.prepare('UPDATE raw_materials SET stock_qty = ?, avg_cost = ? WHERE id = ?')
      .run(newStock, newAvgCost, material_id);
    logMovement('material', material_id, qty, 'purchase', info.lastInsertRowid);

    db.prepare(`INSERT INTO cash_transactions (type, category, amount, description, reference_id, recorded_by)
      VALUES ('out', 'purchase', ?, ?, ?, ?)`)
      .run(paid, `Purchase of ${material.name}`, info.lastInsertRowid, req.user.userId);

    return info.lastInsertRowid;
  });

  const id = run();
  res.json(db.prepare(`SELECT purchases.*, raw_materials.name as material_name FROM purchases
    JOIN raw_materials ON raw_materials.id = purchases.material_id WHERE purchases.id = ?`).get(id));
});

module.exports = router;
