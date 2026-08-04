const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const dataDir = path.join(__dirname, '..', 'data');

// Downloads a consistent snapshot of the live SQLite file (safe to do while
// the app is running - takes a proper SQLite backup rather than copying the
// raw file, so it can't catch a half-written page).
router.get('/download', requireAuth('admin'), async (req, res) => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const snapshotPath = path.join(dataDir, `.snapshot-${stamp}.db`);
  try {
    await db.backupTo(snapshotPath);
    res.download(snapshotPath, `plastpos-backup-${stamp}.db`, (err) => {
      fs.unlink(snapshotPath, () => {});
      if (err && !res.headersSent) res.status(500).json({ error: 'Backup download failed' });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Plain-text exports for opening in Excel/Sheets when a full DB restore isn't needed.
router.get('/export/:table', requireAuth('admin'), (req, res) => {
  const allowed = ['products', 'raw_materials', 'sales', 'sale_items', 'purchases',
    'production_batches', 'customers', 'cash_transactions', 'stock_movements'];
  const table = req.params.table;
  if (!allowed.includes(table)) return res.status(400).json({ error: 'Unknown table' });
  const rows = db.prepare(`SELECT * FROM ${table}`).all();
  if (rows.length === 0) return res.type('text/csv').send('');
  const headers = Object.keys(rows[0]);
  const csv = [headers.join(',')]
    .concat(rows.map(r => headers.map(h => JSON.stringify(r[h] ?? '')).join(',')))
    .join('\n');
  res.type('text/csv').send(csv);
});

module.exports = router;
