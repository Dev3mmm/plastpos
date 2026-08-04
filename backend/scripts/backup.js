// Standalone backup script - run manually or via a scheduled task/cron:
//   node scripts/backup.js [destination-folder]
// Copies the live SQLite database to a timestamped file. Point the
// destination at a USB drive or a synced folder for off-machine safety.
const path = require('path');
const fs = require('fs');
const { DatabaseSync, backup } = require('node:sqlite');

const dataDir = path.join(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'plastpos.db');
const destDir = process.argv[2] || path.join(dataDir, 'backups');

if (!fs.existsSync(dbPath)) {
  console.error('No database found at', dbPath);
  process.exit(1);
}
if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

const db = new DatabaseSync(dbPath, { readOnly: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const destPath = path.join(destDir, `plastpos-backup-${stamp}.db`);

backup(db, destPath)
  .then(() => {
    console.log('Backup written to', destPath);
    db.close();
  })
  .catch(err => {
    console.error('Backup failed:', err);
    db.close();
    process.exit(1);
  });
