const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Any logged-in role can read the list (the Plant Operator needs it to log
// against); only admin manages which machines exist.
router.get('/', requireAuth('admin', 'input'), (req, res) => {
  res.json(db.prepare('SELECT * FROM machines WHERE active = 1 ORDER BY name').all());
});

router.post('/', requireAuth('admin'), (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const info = db.prepare('INSERT INTO machines (name) VALUES (?)').run(name);
  res.json(db.prepare('SELECT * FROM machines WHERE id = ?').get(info.lastInsertRowid));
});

router.delete('/:id', requireAuth('admin'), (req, res) => {
  db.prepare('UPDATE machines SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
