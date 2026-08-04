const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const { uploadsDir } = require('./middleware/upload');

const authRoutes = require('./routes/auth');
const { router: inventoryRoutes } = require('./routes/inventory');
const productionRoutes = require('./routes/production');
const stagesRoutes = require('./routes/stages');
const salesRoutes = require('./routes/sales');
const purchasesRoutes = require('./routes/purchases');
const customersRoutes = require('./routes/customers');
const cashbookRoutes = require('./routes/cashbook');
const reportsRoutes = require('./routes/reports');
const tipsRoutes = require('./routes/tips');
const backupRoutes = require('./routes/backup');
const payrollRoutes = require('./routes/payroll');
const shiftsRoutes = require('./routes/shifts');

// Seed the production chain on first run so the app isn't empty out of the
// box: beads -> rolls (input stage) -> bag packets (cutting stage, via BOM).
// Everything here is editable later from the Inventory screen.
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
  const beads = insertMaterial.run('Plastic Beads', 'kg', 100);
  const rolls = insertMaterial.run('Plastic Roll', 'kg', 50);

  const insertBom = db.prepare('INSERT INTO bom (product_id, material_id, qty_per_unit) VALUES (?, ?, ?)');
  // Placeholder BOM ratios (roll kg consumed per bag) - adjust from
  // Inventory > Bill of Materials to match the real waste factor per size.
  insertBom.run(p1.lastInsertRowid, rolls.lastInsertRowid, 0.03);
  insertBom.run(p2.lastInsertRowid, rolls.lastInsertRowid, 0.055);
  insertBom.run(p3.lastInsertRowid, rolls.lastInsertRowid, 0.1);
}
seedIfEmpty();

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/production', productionRoutes);
app.use('/api/stages', stagesRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/purchases', purchasesRoutes);
app.use('/api/customers', customersRoutes);
app.use('/api/cashbook', cashbookRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/tips', tipsRoutes);
app.use('/api/backup', backupRoutes);
app.use('/api/payroll', payrollRoutes);
app.use('/api/shifts', shiftsRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// Stage photo proof (input/cutting/dispatch) - not auth-gated by design:
// filenames are random and unlisted, and this is a trusted LAN app.
app.use('/uploads', express.static(uploadsDir));

// Serve the PWA frontend
const frontendDir = path.join(__dirname, '..', 'frontend');
app.use(express.static(frontendDir));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return next();
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
