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

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','cashier','production')),
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  size TEXT,
  unit_price REAL NOT NULL DEFAULT 0,
  unit_cost REAL NOT NULL DEFAULT 0,
  stock_qty REAL NOT NULL DEFAULT 0,
  low_stock_threshold REAL NOT NULL DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS raw_materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'kg',
  stock_qty REAL NOT NULL DEFAULT 0,
  low_stock_threshold REAL NOT NULL DEFAULT 0,
  avg_cost REAL NOT NULL DEFAULT 0,
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

CREATE TABLE IF NOT EXISTS production_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty_produced REAL NOT NULL,
  shift TEXT,
  operator_id INTEGER REFERENCES users(id),
  material_cost REAL NOT NULL DEFAULT 0,
  notes TEXT,
  produced_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
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
`);

module.exports = db;
