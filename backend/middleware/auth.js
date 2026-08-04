const crypto = require('crypto');

// In-memory session store. LAN-only, single small server — a restart just
// means everyone logs back in with their PIN, which is fine at this scale.
const sessions = new Map(); // token -> { userId, name, role }

function createSession(user) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { userId: user.id, name: user.name, role: user.role });
  return token;
}

function destroySession(token) {
  sessions.delete(token);
}

function requireAuth(...allowedRoles) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const session = token && sessions.get(token);
    if (!session) return res.status(401).json({ error: 'Not logged in' });
    if (allowedRoles.length && !allowedRoles.includes(session.role)) {
      return res.status(403).json({ error: 'Not allowed for your role' });
    }
    req.user = session;
    next();
  };
}

module.exports = { createSession, destroySession, requireAuth, sessions };
