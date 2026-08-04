const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');

const authRoutes = require('./routes/auth');
const { router: inventoryRoutes } = require('./routes/inventory');
const productionRoutes = require('./routes/production');
const salesRoutes = require('./routes/sales');
const purchasesRoutes = require('./routes/purchases');
const customersRoutes = require('./routes/customers');
const cashbookRoutes = require('./routes/cashbook');
const reportsRoutes = require('./routes/reports');
const tipsRoutes = require('./routes/tips');
const backupRoutes = require('./routes/backup');

// Seed the three bag sizes on first run so the app isn't empty out of the box.
// Everything here (name, price, BOM) is editable later from the Inventory screen.
function seedIfEmpty() {
  const count = db.prepare('SELECT COUNT(*) as n FROM products').get().n;
  if (count > 0) return;
  const insertProduct = db.prepare(`INSERT INTO products (name, size, unit_price, unit_cost, low_stock_threshold)
    VALUES (?, ?, ?, ?, ?)`);
  const p1 = insertProduct.run('Paper Bag 1/2kg', '0.5kg', 5, 2, 200);
  const p2 = insertProduct.run('Paper Bag 1kg', '1kg', 8, 3.5, 200);
  const p3 = insertProduct.run('Paper Bag 2kg', '2kg', 14, 6, 150);

  const insertMaterial = db.prepare(`INSERT INTO raw_materials (name, unit, low_stock_threshold)
    VALUES (?, ?, ?)`);
  const m1 = insertMaterial.run('Kraft Paper Roll', 'kg', 50);
  const m2 = insertMaterial.run('Ink', 'kg', 5);

  const insertBom = db.prepare('INSERT INTO bom (product_id, material_id, qty_per_unit) VALUES (?, ?, ?)');
  // Placeholder BOM ratios - adjust from the Inventory > Bill of Materials screen
  // to match the actual paper weight/waste factor for each bag size.
  for (const [productId, paperQty] of [[p1.lastInsertRowid, 0.03], [p2.lastInsertRowid, 0.055], [p3.lastInsertRowid, 0.1]]) {
    insertBom.run(productId, m1.lastInsertRowid, paperQty);
    insertBom.run(productId, m2.lastInsertRowid, paperQty * 0.05);
  }
}
seedIfEmpty();

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/production', productionRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/purchases', purchasesRoutes);
app.use('/api/customers', customersRoutes);
app.use('/api/cashbook', cashbookRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/tips', tipsRoutes);
app.use('/api/backup', backupRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// Serve the PWA frontend
const frontendDir = path.join(__dirname, '..', 'frontend');
app.use(express.static(frontendDir));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(frontendDir, 'index.html'));
});

const PORT = process.env.PORT || 4000;
// Bind 0.0.0.0 so phones on the same router's WiFi can reach it via the
// server machine's LAN IP, e.g. http://192.168.1.10:4000
app.listen(PORT, '0.0.0.0', () => {
  console.log(`PlastPOS server running on port ${PORT}`);
  console.log(`On this machine:   http://localhost:${PORT}`);
  console.log(`From phones on WiFi: http://<this-computer's-LAN-IP>:${PORT}`);
});
