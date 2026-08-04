const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { upload } = require('../middleware/upload');
const { logMovement } = require('./inventory');

const router = express.Router();

// ---------------- Input stage: beads in, rolls out ----------------

// Workers only see their own entries here - admin sees everyone's.
router.get('/input', requireAuth('admin', 'input'), (req, res) => {
  const own = req.user.role !== 'admin';
  const rows = db.prepare(`SELECT material_conversions.*, users.name as operator_name,
      im.name as input_material_name, im.unit as input_unit,
      om.name as output_material_name, om.unit as output_unit,
      machines.name as machine_name
    FROM material_conversions
    LEFT JOIN users ON users.id = material_conversions.operator_id
    LEFT JOIN machines ON machines.id = material_conversions.machine_id
    JOIN raw_materials im ON im.id = material_conversions.input_material_id
    JOIN raw_materials om ON om.id = material_conversions.output_material_id
    WHERE ${own ? 'material_conversions.operator_id = ?' : '1=1'}
    ORDER BY created_at DESC LIMIT 200`).all(...(own ? [req.user.userId] : []));
  res.json(rows);
});

router.post('/input', requireAuth('admin', 'input'), upload.single('photo'), (req, res) => {
  const { input_material_id, input_qty, output_material_id, output_qty, source_company, notes, machine_id } = req.body;
  const inQty = Number(input_qty);
  const outQty = Number(output_qty);
  if (!input_material_id || !output_material_id || !inQty || inQty <= 0 || !outQty || outQty <= 0) {
    return res.status(400).json({ error: 'input/output material and positive quantities are required' });
  }
  if (String(input_material_id) === String(output_material_id)) {
    return res.status(400).json({ error: 'Input and output material must be different' });
  }
  const inputMaterial = db.prepare('SELECT * FROM raw_materials WHERE id = ?').get(input_material_id);
  if (!inputMaterial) return res.status(404).json({ error: 'Input material not found' });
  if (inputMaterial.stock_qty < inQty) return res.status(400).json({ error: `Not enough ${inputMaterial.name} in stock` });
  const outputMaterial = db.prepare('SELECT * FROM raw_materials WHERE id = ?').get(output_material_id);
  if (!outputMaterial) return res.status(404).json({ error: 'Output material not found' });

  const run = db.transaction(() => {
    db.prepare('UPDATE raw_materials SET stock_qty = stock_qty - ? WHERE id = ?').run(inQty, input_material_id);

    // Carry the cost basis through the conversion so "rolls" have a real cost,
    // not just a stock count.
    const costTransferred = inputMaterial.avg_cost * inQty;
    const newOutputStock = outputMaterial.stock_qty + outQty;
    const newOutputAvgCost = newOutputStock > 0
      ? ((outputMaterial.stock_qty * outputMaterial.avg_cost) + costTransferred) / newOutputStock
      : 0;
    db.prepare('UPDATE raw_materials SET stock_qty = ?, avg_cost = ? WHERE id = ?')
      .run(newOutputStock, newOutputAvgCost, output_material_id);

    const info = db.prepare(`INSERT INTO material_conversions
      (input_material_id, input_qty, output_material_id, output_qty, operator_id, source_company, photo_path, notes, machine_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(input_material_id, inQty, output_material_id, outQty, req.user.userId,
        source_company || '', req.file ? req.file.filename : null, notes || '', machine_id || null);

    logMovement('material', input_material_id, -inQty, 'conversion_out', info.lastInsertRowid);
    logMovement('material', output_material_id, outQty, 'conversion_in', info.lastInsertRowid);
    return info.lastInsertRowid;
  });

  let id;
  try { id = run(); } catch (err) { return res.status(400).json({ error: err.message }); }
  res.json(db.prepare('SELECT * FROM material_conversions WHERE id = ?').get(id));
});

// ---------------- Electricity: daily reading, logged by Plant Operator ----------------

router.get('/electricity', requireAuth('admin', 'input'), (req, res) => {
  res.json(db.prepare(`SELECT electricity_logs.*, users.name as operator_name FROM electricity_logs
    LEFT JOIN users ON users.id = electricity_logs.operator_id
    ORDER BY log_date DESC LIMIT 60`).all());
});

router.post('/electricity', requireAuth('admin', 'input'), (req, res) => {
  const kwh = Number(req.body.kwh);
  if (!kwh || kwh <= 0) return res.status(400).json({ error: 'a positive kwh reading is required' });
  const rateRow = db.prepare(`SELECT value FROM settings WHERE key = 'electricity_rate_per_kwh'`).get();
  const rate = rateRow ? Number(rateRow.value) || 0 : 0;
  const cost = req.body.cost != null && req.body.cost !== '' ? Number(req.body.cost) : kwh * rate;
  const logDate = req.body.log_date || new Date().toISOString().slice(0, 10);

  const info = db.prepare(`INSERT INTO electricity_logs (log_date, kwh, cost, operator_id, notes)
    VALUES (?, ?, ?, ?, ?)`).run(logDate, kwh, cost, req.user.userId, req.body.notes || '');
  res.json(db.prepare('SELECT * FROM electricity_logs WHERE id = ?').get(info.lastInsertRowid));
});

// ---------------- Picking: collects packed packets from Packaging ----------------
// Different job from Delivery below - this is the internal handoff, not the
// vehicle run to a customer. Doesn't move stock (Packaging already did),
// it's a confirmation/traceability record and the basis for Picking's pay.

router.get('/picking', requireAuth('admin', 'picking'), (req, res) => {
  const own = req.user.role !== 'admin';
  const rows = db.prepare(`SELECT picking_logs.*, products.name as product_name, products.size,
      users.name as operator_name
    FROM picking_logs
    JOIN products ON products.id = picking_logs.product_id
    LEFT JOIN users ON users.id = picking_logs.operator_id
    WHERE ${own ? 'picking_logs.operator_id = ?' : '1=1'}
    ORDER BY created_at DESC LIMIT 200`).all(...(own ? [req.user.userId] : []));
  res.json(rows);
});

router.post('/picking', requireAuth('admin', 'picking'), upload.single('photo'), (req, res) => {
  const { product_id, notes } = req.body;
  const qty = Number(req.body.qty);
  if (!product_id || !qty || qty <= 0) return res.status(400).json({ error: 'product and a positive qty are required' });
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(product_id);
  if (!product) return res.status(404).json({ error: 'Product not found' });

  const info = db.prepare(`INSERT INTO picking_logs (product_id, qty, operator_id, photo_path, notes)
    VALUES (?, ?, ?, ?, ?)`).run(product_id, qty, req.user.userId, req.file ? req.file.filename : null, notes || '');
  res.json(db.prepare(`SELECT picking_logs.*, products.name as product_name FROM picking_logs
    JOIN products ON products.id = picking_logs.product_id WHERE picking_logs.id = ?`).get(info.lastInsertRowid));
});

// ---------------- Delivery (role: distribution): packets out to a person/place ----------------

router.get('/dispatch', requireAuth('admin', 'distribution'), (req, res) => {
  const own = req.user.role !== 'admin';
  const rows = db.prepare(`SELECT dispatches.*, products.name as product_name, products.size,
      users.name as operator_name
    FROM dispatches
    JOIN products ON products.id = dispatches.product_id
    LEFT JOIN users ON users.id = dispatches.operator_id
    WHERE ${own ? 'dispatches.operator_id = ?' : '1=1'}
    ORDER BY dispatched_at DESC LIMIT 200`).all(...(own ? [req.user.userId] : []));
  res.json(rows);
});

// One delivery, for the delivery receipt/slip shown to the Picking worker.
router.get('/dispatch/:id', requireAuth('admin', 'distribution'), (req, res) => {
  const row = db.prepare(`SELECT dispatches.*, products.name as product_name, products.size,
      users.name as operator_name
    FROM dispatches
    JOIN products ON products.id = dispatches.product_id
    LEFT JOIN users ON users.id = dispatches.operator_id
    WHERE dispatches.id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

router.post('/dispatch', requireAuth('admin', 'distribution'), upload.single('photo'), (req, res) => {
  const { product_id, qty, destination_person, destination_place, vehicle, notes,
    amount_collected, payment_method, paid, order_id } = req.body;
  const q = Number(qty);
  if (!product_id || !q || q <= 0) return res.status(400).json({ error: 'product and a positive qty are required' });
  if (!destination_person && !destination_place) {
    return res.status(400).json({ error: 'destination person or place is required' });
  }
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(product_id);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  if (product.stock_qty < q) return res.status(400).json({ error: `Not enough ${product.name} in stock` });
  const collected = Number(amount_collected) || 0;

  const run = db.transaction(() => {
    db.prepare('UPDATE products SET stock_qty = stock_qty - ? WHERE id = ?').run(q, product_id);
    const info = db.prepare(`INSERT INTO dispatches
      (product_id, qty, destination_person, destination_place, vehicle, amount_collected, payment_method, paid,
       operator_id, photo_path, notes, order_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(product_id, q, destination_person || '', destination_place || '', vehicle || '',
        collected, payment_method || '', paid ? 1 : 0, req.user.userId,
        req.file ? req.file.filename : null, notes || '', order_id || null);
    logMovement('product', product_id, -q, 'dispatch', info.lastInsertRowid);
    if (collected > 0) {
      db.prepare(`INSERT INTO cash_transactions (type, category, amount, description, reference_id, recorded_by)
        VALUES ('in', 'dispatch_payment', ?, ?, ?, ?)`)
        .run(collected, `Payment collected on delivery to ${destination_person || destination_place}`,
          info.lastInsertRowid, req.user.userId);
    }
    if (order_id) {
      db.prepare(`UPDATE orders SET status = 'fulfilled', fulfilled_by = ?, fulfilled_at = datetime('now') WHERE id = ?`)
        .run(req.user.userId, order_id);
    }
    return info.lastInsertRowid;
  });

  let id;
  try { id = run(); } catch (err) { return res.status(400).json({ error: err.message }); }
  res.json(db.prepare(`SELECT dispatches.*, products.name as product_name FROM dispatches
    JOIN products ON products.id = dispatches.product_id WHERE dispatches.id = ?`).get(id));
});

// PUT /api/stages/dispatch/:id/collect - record payment collected after the
// fact (distributor delivered on credit, settles up later). Only posts the
// NEW amount to the cash book, not the running total, so it can't double-count.
router.put('/dispatch/:id/collect', requireAuth('admin', 'distribution'), (req, res) => {
  const dispatch = db.prepare('SELECT * FROM dispatches WHERE id = ?').get(req.params.id);
  if (!dispatch) return res.status(404).json({ error: 'Not found' });
  const newAmount = Number(req.body.amount_collected);
  const paymentMethod = req.body.payment_method || dispatch.payment_method;
  if (!newAmount || newAmount <= 0) return res.status(400).json({ error: 'positive amount_collected is required' });

  const run = db.transaction(() => {
    const totalCollected = dispatch.amount_collected + newAmount;
    db.prepare(`UPDATE dispatches SET amount_collected = ?, payment_method = ?, paid = ? WHERE id = ?`)
      .run(totalCollected, paymentMethod, req.body.paid ? 1 : dispatch.paid, req.params.id);
    db.prepare(`INSERT INTO cash_transactions (type, category, amount, description, reference_id, recorded_by)
      VALUES ('in', 'dispatch_payment', ?, ?, ?, ?)`)
      .run(newAmount, `Payment collected for dispatch #${dispatch.id} (${dispatch.destination_person || dispatch.destination_place})`,
        dispatch.id, req.user.userId);
  });
  run();
  res.json(db.prepare('SELECT * FROM dispatches WHERE id = ?').get(req.params.id));
});

// ---------------- Admin oversight: who did what today/yesterday ----------------

router.get('/today-status', requireAuth('admin'), (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  function counts(table, dateCol) {
    return db.prepare(`SELECT
        SUM(CASE WHEN date(${dateCol}) = ? THEN 1 ELSE 0 END) as today_count,
        SUM(CASE WHEN date(${dateCol}) = ? THEN 1 ELSE 0 END) as yesterday_count
      FROM ${table}`).get(today, yesterday);
  }

  const input = counts('material_conversions', 'created_at');
  const cutting = counts('production_batches', 'produced_at');
  const picking = counts('picking_logs', 'created_at');
  const distribution = counts('dispatches', 'dispatched_at');
  const cashier = counts('sales', 'sold_at');

  const latest = {
    input: db.prepare(`SELECT material_conversions.*, users.name as operator_name,
        im.name as input_material_name, im.unit as input_unit,
        om.name as output_material_name, om.unit as output_unit
      FROM material_conversions
      LEFT JOIN users ON users.id = material_conversions.operator_id
      JOIN raw_materials im ON im.id = material_conversions.input_material_id
      JOIN raw_materials om ON om.id = material_conversions.output_material_id
      ORDER BY created_at DESC LIMIT 5`).all(),
    cutting: db.prepare(`SELECT production_batches.*, products.name as product_name, users.name as operator_name
      FROM production_batches JOIN products ON products.id = production_batches.product_id
      LEFT JOIN users ON users.id = production_batches.operator_id ORDER BY produced_at DESC LIMIT 5`).all(),
    picking: db.prepare(`SELECT picking_logs.*, products.name as product_name, users.name as operator_name
      FROM picking_logs JOIN products ON products.id = picking_logs.product_id
      LEFT JOIN users ON users.id = picking_logs.operator_id ORDER BY created_at DESC LIMIT 5`).all(),
    distribution: db.prepare(`SELECT dispatches.*, products.name as product_name, users.name as operator_name
      FROM dispatches JOIN products ON products.id = dispatches.product_id
      LEFT JOIN users ON users.id = dispatches.operator_id ORDER BY dispatched_at DESC LIMIT 5`).all(),
    cashier: db.prepare(`SELECT sales.*, users.name as operator_name FROM sales
      LEFT JOIN users ON users.id = sales.cashier_id ORDER BY sold_at DESC LIMIT 5`).all(),
  };

  res.json({
    today, yesterday,
    stages: [
      { role: 'input', label: 'Plant Operator', today_count: input.today_count || 0, yesterday_count: input.yesterday_count || 0, latest: latest.input },
      { role: 'cutting', label: 'Packaging', today_count: cutting.today_count || 0, yesterday_count: cutting.yesterday_count || 0, latest: latest.cutting },
      { role: 'picking', label: 'Picking', today_count: picking.today_count || 0, yesterday_count: picking.yesterday_count || 0, latest: latest.picking },
      { role: 'distribution', label: 'Delivery', today_count: distribution.today_count || 0, yesterday_count: distribution.yesterday_count || 0, latest: latest.distribution },
      { role: 'cashier', label: 'Cashier / POS', today_count: cashier.today_count || 0, yesterday_count: cashier.yesterday_count || 0, latest: latest.cashier },
    ],
  });
});

module.exports = router;
