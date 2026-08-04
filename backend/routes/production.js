const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { upload } = require('../middleware/upload');
const { logMovement } = require('./inventory');

const router = express.Router();

// This is the Cutting stage: rolls (raw material, via BOM) in, bag packets
// (product) out. Table/route names kept as "production" for history.
// Workers only ever see their own batches here - admin is the only one
// who sees everyone's (via the Dashboard activity feed / Reports).
router.get('/', requireAuth('admin', 'cutting'), (req, res) => {
  const { from, to } = req.query;
  let sql = `SELECT production_batches.*, products.name as product_name, products.size,
    users.name as operator_name
    FROM production_batches
    JOIN products ON products.id = production_batches.product_id
    LEFT JOIN users ON users.id = production_batches.operator_id
    WHERE 1=1`;
  const params = [];
  if (req.user.role !== 'admin') { sql += ' AND production_batches.operator_id = ?'; params.push(req.user.userId); }
  if (from) { sql += ' AND produced_at >= ?'; params.push(from); }
  if (to) { sql += ' AND produced_at <= ?'; params.push(to); }
  sql += ' ORDER BY produced_at DESC LIMIT 500';
  res.json(db.prepare(sql).all(...params));
});

// Record a production run: pulls raw materials per the product's BOM,
// adds finished stock, and prices the batch off the materials' average cost.
router.post('/', requireAuth('admin', 'cutting'), upload.single('photo'), (req, res) => {
  const { product_id, qty_produced, shift, notes } = req.body;
  const qty = Number(qty_produced);
  if (!product_id || !qty || qty <= 0) {
    return res.status(400).json({ error: 'product_id and a positive qty_produced are required' });
  }
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(product_id);
  if (!product) return res.status(404).json({ error: 'Product not found' });

  const bomLines = db.prepare('SELECT * FROM bom WHERE product_id = ?').all(product_id);

  const run = db.transaction(() => {
    let materialCost = 0;
    for (const line of bomLines) {
      const material = db.prepare('SELECT * FROM raw_materials WHERE id = ?').get(line.material_id);
      const needed = line.qty_per_unit * qty;
      db.prepare('UPDATE raw_materials SET stock_qty = stock_qty - ? WHERE id = ?')
        .run(needed, line.material_id);
      logMovement('material', line.material_id, -needed, 'production');
      materialCost += needed * (material ? material.avg_cost : 0);
    }

    const info = db.prepare(`INSERT INTO production_batches
      (product_id, qty_produced, shift, operator_id, material_cost, notes, photo_path)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(product_id, qty, shift || '', req.user.userId, materialCost, notes || '',
        req.file ? req.file.filename : null);

    db.prepare('UPDATE products SET stock_qty = stock_qty + ? WHERE id = ?').run(qty, product_id);
    logMovement('product', product_id, qty, 'production', info.lastInsertRowid);

    return info.lastInsertRowid;
  });

  let id;
  try { id = run(); } catch (err) { return res.status(400).json({ error: err.message }); }
  const batch = db.prepare(`SELECT production_batches.*, products.name as product_name
    FROM production_batches JOIN products ON products.id = production_batches.product_id
    WHERE production_batches.id = ?`).get(id);
  res.json(batch);
});

module.exports = router;
