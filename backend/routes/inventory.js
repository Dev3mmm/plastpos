const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function logMovement(itemType, itemId, changeQty, reason, referenceId) {
  db.prepare(`INSERT INTO stock_movements (item_type, item_id, change_qty, reason, reference_id)
    VALUES (?, ?, ?, ?, ?)`).run(itemType, itemId, changeQty, reason, referenceId || null);
}

// ---- Products (finished goods: 0.5kg / 1kg / 2kg bags etc.) ----

router.get('/products', (req, res) => {
  res.json(db.prepare('SELECT * FROM products WHERE active = 1 ORDER BY size, name').all());
});

router.post('/products', requireAuth('admin'), (req, res) => {
  const { name, size, unit_price, unit_cost, low_stock_threshold } = req.body;
  if (!name || unit_price == null) return res.status(400).json({ error: 'name and unit_price are required' });
  const info = db.prepare(`INSERT INTO products (name, size, unit_price, unit_cost, low_stock_threshold)
    VALUES (?, ?, ?, ?, ?)`).run(name, size || '', unit_price, unit_cost || 0, low_stock_threshold || 0);
  res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/products/:id', requireAuth('admin'), (req, res) => {
  const { name, size, unit_price, unit_cost, low_stock_threshold, active } = req.body;
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  db.prepare(`UPDATE products SET name=?, size=?, unit_price=?, unit_cost=?, low_stock_threshold=?, active=?
    WHERE id=?`).run(
    name ?? p.name, size ?? p.size, unit_price ?? p.unit_price, unit_cost ?? p.unit_cost,
    low_stock_threshold ?? p.low_stock_threshold, active ?? p.active, req.params.id
  );
  res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id));
});

router.post('/products/:id/adjust', requireAuth('admin'), (req, res) => {
  const { change_qty, reason } = req.body;
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE products SET stock_qty = stock_qty + ? WHERE id = ?').run(change_qty, req.params.id);
  logMovement('product', req.params.id, change_qty, reason || 'adjustment');
  res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id));
});

// ---- Raw materials ----

router.get('/materials', (req, res) => {
  res.json(db.prepare('SELECT * FROM raw_materials ORDER BY name').all());
});

router.post('/materials', requireAuth('admin'), (req, res) => {
  const { name, unit, low_stock_threshold } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const info = db.prepare('INSERT INTO raw_materials (name, unit, low_stock_threshold) VALUES (?, ?, ?)')
    .run(name, unit || 'kg', low_stock_threshold || 0);
  res.json(db.prepare('SELECT * FROM raw_materials WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/materials/:id', requireAuth('admin'), (req, res) => {
  const { name, unit, low_stock_threshold } = req.body;
  const m = db.prepare('SELECT * FROM raw_materials WHERE id = ?').get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE raw_materials SET name=?, unit=?, low_stock_threshold=? WHERE id=?')
    .run(name ?? m.name, unit ?? m.unit, low_stock_threshold ?? m.low_stock_threshold, req.params.id);
  res.json(db.prepare('SELECT * FROM raw_materials WHERE id = ?').get(req.params.id));
});

router.post('/materials/:id/adjust', requireAuth('admin'), (req, res) => {
  const { change_qty, reason } = req.body;
  const m = db.prepare('SELECT * FROM raw_materials WHERE id = ?').get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE raw_materials SET stock_qty = stock_qty + ? WHERE id = ?').run(change_qty, req.params.id);
  logMovement('material', req.params.id, change_qty, reason || 'adjustment');
  res.json(db.prepare('SELECT * FROM raw_materials WHERE id = ?').get(req.params.id));
});

// ---- Bill of Materials (how much raw material each product size consumes) ----

router.get('/bom/:productId', (req, res) => {
  res.json(db.prepare(`SELECT bom.*, raw_materials.name as material_name, raw_materials.unit
    FROM bom JOIN raw_materials ON raw_materials.id = bom.material_id
    WHERE product_id = ?`).all(req.params.productId));
});

router.post('/bom', requireAuth('admin'), (req, res) => {
  const { product_id, material_id, qty_per_unit } = req.body;
  if (!product_id || !material_id || qty_per_unit == null) {
    return res.status(400).json({ error: 'product_id, material_id and qty_per_unit are required' });
  }
  const info = db.prepare('INSERT INTO bom (product_id, material_id, qty_per_unit) VALUES (?, ?, ?)')
    .run(product_id, material_id, qty_per_unit);
  res.json({ id: info.lastInsertRowid, product_id, material_id, qty_per_unit });
});

router.delete('/bom/:id', requireAuth('admin'), (req, res) => {
  db.prepare('DELETE FROM bom WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---- Low stock overview (used by dashboard + AI tips) ----

router.get('/low-stock', (req, res) => {
  const products = db.prepare(`SELECT *, 'product' as item_type FROM products
    WHERE active = 1 AND stock_qty <= low_stock_threshold`).all();
  const materials = db.prepare(`SELECT *, 'material' as item_type FROM raw_materials
    WHERE stock_qty <= low_stock_threshold`).all();
  res.json({ products, materials });
});

router.get('/movements', requireAuth('admin'), (req, res) => {
  const { item_type, item_id, limit } = req.query;
  let sql = 'SELECT * FROM stock_movements WHERE 1=1';
  const params = [];
  if (item_type) { sql += ' AND item_type = ?'; params.push(item_type); }
  if (item_id) { sql += ' AND item_id = ?'; params.push(item_id); }
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(Number(limit) || 200);
  res.json(db.prepare(sql).all(...params));
});

module.exports = { router, logMovement };
