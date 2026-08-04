const crypto = require('crypto');
const db = require('../db');

// Sessions are stored in the DB (see sessions table) specifically so a
// server restart doesn't invisibly log everyone out - it just means the
// server was down for a couple seconds, not that every phone needs to
// re-login.
function createSession(user) {
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, name, role) VALUES (?, ?, ?, ?)')
    .run(token, user.id, user.name, user.role);
  return token;
}

function destroySession(token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function isLocked() {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'system_locked'`).get();
  return row && row.value === '1';
}

function requireAuth(...allowedRoles) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const session = token && db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
    if (!session) return res.status(401).json({ error: 'Not logged in' });
    if (session.role !== 'admin' && isLocked()) {
      return res.status(423).json({ error: 'System is locked by the admin. Try again later.' });
    }
    if (allowedRoles.length && !allowedRoles.includes(session.role)) {
      return res.status(403).json({ error: 'Not allowed for your role' });
    }
    req.user = { userId: session.user_id, name: session.name, role: session.role };
    req.token = token;
    next();
  };
}

module.exports = { createSession, destroySession, requireAuth, isLocked };
