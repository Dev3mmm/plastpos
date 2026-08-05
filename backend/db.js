const path = require('path');
const fs = require('fs');
// Node's built-in SQLite (stable enough to use, still flagged "experimental"
// by Node itself as of Node 22-24). Chosen over better-sqlite3 specifically
// because it needs zero native compilation - no Visual Studio / build-essential
// required on whatever machine this ends up installed on. Requires Node >= 22.5.
const { DatabaseSync, backup: sqliteBackup } = require('node:sqlite');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'plastpos.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// better-sqlite3-style helpers so the rest of the app can stay written
// against that familiar shape.
db.transaction = function (fn) {
  return function (...args) {
    db.exec('BEGIN');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch (_) { /* nothing to roll back */ }
      throw err;
    }
  };
};
db.pragma = function (stmt) {
  return db.exec(`PRAGMA ${stmt}`);
};
db.backupTo = function (destPath) {
  return sqliteBackup(db, destPath);
};

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Roles map to the physical stages of making a bag:
--   input        - feeds plastic beads into the extruder, logs rolls produced
--   cutting      - cuts rolls into bag packets by size (0.5kg/1kg/2kg)
--   picking      - collects the packed packets from Packaging (internal handoff)
--   distribution - (labelled "Delivery") takes packets out to a customer/location by vehicle
--   cashier      - runs the POS
--   admin        - sees and manages everything
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','cashier','input','cutting','picking','distribution')),
  piece_rate REAL NOT NULL DEFAULT 0,
  pay_type TEXT NOT NULL DEFAULT 'piece' CHECK(pay_type IN ('piece','shift','trip','monthly')),
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Stock is always tracked in individual pieces internally (that's the sale/
-- delivery unit), but Packaging counts what they cut in packets (e.g. 100
-- pieces per packet) - pack_qty is the usual pieces-per-packet, pack_unit_label
-- is what the packet is called. Same "default suggestion, overridable per
-- entry" pattern as raw_materials' sack fields, so a differently-sized batch
-- doesn't force a schema/config change.
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  size TEXT,
  unit_price REAL NOT NULL DEFAULT 0,
  unit_cost REAL NOT NULL DEFAULT 0,
  stock_qty REAL NOT NULL DEFAULT 0,
  low_stock_threshold REAL NOT NULL DEFAULT 0,
  pack_qty REAL,
  pack_unit_label TEXT,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Stock is always tracked in kg internally (that's what a machine actually
-- consumes), but a material can optionally be sold/produced in packed units
-- (sack, roll, bag, drum...) of a usual weight - sack_weight_kg is that
-- usual weight per unit, pack_unit_label is what the unit is called (blank
-- defaults to "sack" in the UI). Both are just a default suggestion the
-- Purchases/Input screens prefill - each individual entry can override the
-- weight per unit, since different suppliers/batches pack differently.
CREATE TABLE IF NOT EXISTS raw_materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'kg',
  stock_qty REAL NOT NULL DEFAULT 0,
  low_stock_threshold REAL NOT NULL DEFAULT 0,
  avg_cost REAL NOT NULL DEFAULT 0,
  sack_weight_kg REAL,
  pack_unit_label TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bom (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  material_id INTEGER NOT NULL REFERENCES raw_materials(id) ON DELETE CASCADE,
  qty_per_unit REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER REFERENCES suppliers(id),
  material_id INTEGER NOT NULL REFERENCES raw_materials(id),
  qty REAL NOT NULL,
  unit_cost REAL NOT NULL,
  total_cost REAL NOT NULL,
  paid_amount REAL NOT NULL DEFAULT 0,
  purchase_date TEXT DEFAULT (datetime('now')),
  created_by INTEGER REFERENCES users(id)
);

-- Cutting stage: rolls in (via BOM) -> bag packets out. Existing table name
-- kept as-is; "production" in code/comments below means specifically cutting.
CREATE TABLE IF NOT EXISTS production_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty_produced REAL NOT NULL,
  shift TEXT,
  operator_id INTEGER REFERENCES users(id),
  material_cost REAL NOT NULL DEFAULT 0,
  notes TEXT,
  photo_path TEXT,
  produced_at TEXT DEFAULT (datetime('now'))
);

-- Input stage: plastic beads (or any raw material) go in, rolls (or any
-- other raw material) come out. Both sides are raw_materials rows, so
-- "rolls" is just another material - no separate stock model needed.
CREATE TABLE IF NOT EXISTS material_conversions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  input_material_id INTEGER NOT NULL REFERENCES raw_materials(id),
  input_qty REAL NOT NULL,
  output_material_id INTEGER NOT NULL REFERENCES raw_materials(id),
  output_qty REAL NOT NULL,
  operator_id INTEGER REFERENCES users(id),
  source_company TEXT,
  photo_path TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Distribution stage: finished bag packets leaving the plant to a
-- distributor/agent/location, by a named vehicle. Deducts finished stock
-- immediately; payment collection (cash/M-Pesa/bank) can be logged at
-- dispatch time or added later once the distributor settles up.
CREATE TABLE IF NOT EXISTS dispatches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty REAL NOT NULL,
  destination_person TEXT,
  destination_place TEXT,
  vehicle TEXT,
  amount_collected REAL NOT NULL DEFAULT 0,
  payment_method TEXT,
  paid INTEGER NOT NULL DEFAULT 0,
  operator_id INTEGER REFERENCES users(id),
  photo_path TEXT,
  notes TEXT,
  dispatched_at TEXT DEFAULT (datetime('now'))
);

-- Clock in/out per worker, plus an optional daily schedule on users
-- (shift_start/shift_end) so the app can sound a same-WiFi alarm.
CREATE TABLE IF NOT EXISTS shift_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  clock_in TEXT NOT NULL DEFAULT (datetime('now')),
  clock_out TEXT
);
CREATE INDEX IF NOT EXISTS idx_shift_user ON shift_logs(user_id);

-- Machines the Plant Operator can choose from when logging (admin-managed).
CREATE TABLE IF NOT EXISTS machines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Daily electricity reading, logged by the Plant Operator, feeds into the
-- admin's running-costs figure alongside materials and wages.
CREATE TABLE IF NOT EXISTS electricity_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  log_date TEXT NOT NULL,
  kwh REAL NOT NULL,
  cost REAL NOT NULL DEFAULT 0,
  operator_id INTEGER REFERENCES users(id),
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_electricity_date ON electricity_logs(log_date);

-- Customer orders (a request, not a sale/payment). Queued for Picking to
-- fulfil; if stock's short, Packaging/Plant Operator see it as a tip until
-- either stock catches up or it's marked fulfilled.
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','fulfilled','cancelled')),
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  fulfilled_by INTEGER REFERENCES users(id),
  fulfilled_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

-- Picking: a separate job from Delivery - this is the person who physically
-- collects the packed packets from Packaging (an internal handoff), not the
-- one taking them out to a customer. A confirmation/traceability record and
-- the basis for the Picking role's pay - it does not itself move stock,
-- since Packaging already credited stock_qty when the batch was logged.
CREATE TABLE IF NOT EXISTS picking_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty REAL NOT NULL,
  operator_id INTEGER REFERENCES users(id),
  photo_path TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_picking_date ON picking_logs(created_at);

-- "I forgot my PIN / typed it wrong" - a public (pre-login) ping to admin
-- asking for a reset, since there's no email/SMS to send one automatically.
CREATE TABLE IF NOT EXISTS pin_reset_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  requested_at TEXT DEFAULT (datetime('now')),
  resolved_at TEXT,
  resolved_by INTEGER REFERENCES users(id)
);

-- Login sessions live in the DB, not just memory, specifically so a server
-- restart/crash-recovery (systemd Restart=always, a nightly reboot, a power
-- blip) doesn't silently log every staff member out mid-shift.
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  login_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  location TEXT,
  balance REAL NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_no TEXT UNIQUE NOT NULL,
  customer_id INTEGER REFERENCES customers(id),
  total_amount REAL NOT NULL,
  amount_paid REAL NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'cash',
  status TEXT NOT NULL DEFAULT 'completed',
  cashier_id INTEGER REFERENCES users(id),
  sold_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty REAL NOT NULL,
  unit_price REAL NOT NULL,
  subtotal REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS cash_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('in','out')),
  category TEXT NOT NULL,
  amount REAL NOT NULL,
  description TEXT,
  reference_id INTEGER,
  recorded_by INTEGER REFERENCES users(id),
  recorded_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_type TEXT NOT NULL CHECK(item_type IN ('product','material')),
  item_id INTEGER NOT NULL,
  change_qty REAL NOT NULL,
  reason TEXT NOT NULL,
  reference_id INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(sold_at);
CREATE INDEX IF NOT EXISTS idx_purchases_date ON purchases(purchase_date);
CREATE INDEX IF NOT EXISTS idx_production_date ON production_batches(produced_at);
CREATE INDEX IF NOT EXISTS idx_cash_date ON cash_transactions(recorded_at);
CREATE INDEX IF NOT EXISTS idx_stock_item ON stock_movements(item_type, item_id);
CREATE INDEX IF NOT EXISTS idx_conversions_date ON material_conversions(created_at);
CREATE INDEX IF NOT EXISTS idx_dispatches_date ON dispatches(dispatched_at);

-- Piece-rate wage payments: each payment closes out a period so "unpaid
-- output" is always just "output logged since the last payment".
CREATE TABLE IF NOT EXISTS payroll_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  amount REAL NOT NULL,
  output_qty REAL NOT NULL,
  period_from TEXT NOT NULL,
  period_to TEXT NOT NULL,
  notes TEXT,
  photo_path TEXT,
  paid_by INTEGER REFERENCES users(id),
  paid_at TEXT DEFAULT (datetime('now')),
  disputed INTEGER NOT NULL DEFAULT 0,
  dispute_note TEXT,
  disputed_at TEXT,
  resolved_at TEXT,
  resolution_note TEXT
);
CREATE INDEX IF NOT EXISTS idx_payroll_user ON payroll_payments(user_id);
`);

// Lightweight forward-compatible migration: adds columns that didn't exist
// in older dev databases, so the app never needs "just delete the db file".
function tryAddColumn(table, columnDef) {
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`); } catch (_) { /* already exists */ }
}
tryAddColumn('users', 'piece_rate REAL NOT NULL DEFAULT 0');
tryAddColumn('payroll_payments', 'photo_path TEXT');
tryAddColumn('payroll_payments', 'disputed INTEGER NOT NULL DEFAULT 0');
tryAddColumn('payroll_payments', 'dispute_note TEXT');
tryAddColumn('payroll_payments', 'disputed_at TEXT');
tryAddColumn('payroll_payments', 'resolved_at TEXT');
tryAddColumn('payroll_payments', 'resolution_note TEXT');
tryAddColumn('users', 'shift_start TEXT');
tryAddColumn('users', 'shift_end TEXT');
tryAddColumn('users', 'first_login_at TEXT');
tryAddColumn('dispatches', 'vehicle TEXT');
tryAddColumn('dispatches', 'amount_collected REAL NOT NULL DEFAULT 0');
tryAddColumn('dispatches', 'payment_method TEXT');
tryAddColumn('dispatches', 'paid INTEGER NOT NULL DEFAULT 0');
tryAddColumn('material_conversions', 'machine_id INTEGER REFERENCES machines(id)');
tryAddColumn('dispatches', 'order_id INTEGER REFERENCES orders(id)');
tryAddColumn('raw_materials', 'sack_weight_kg REAL');
tryAddColumn('raw_materials', 'pack_unit_label TEXT');
tryAddColumn('products', 'pack_qty REAL');
tryAddColumn('products', 'pack_unit_label TEXT');
tryAddColumn('users', "pay_type TEXT NOT NULL DEFAULT 'piece'");
tryAddColumn('customers', 'location TEXT');

module.exports = db;
