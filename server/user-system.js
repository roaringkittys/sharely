/**
 * Sharely User Access System
 * Handles: token-based registration, magic-link login,
 * device binding, session management, admin token/user management.
 */

const express = require('express');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const router = express.Router();

let db; // injected via init()

function init(database) {
  db = database;

  // ── Schema ────────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS access_tokens (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      token       TEXT UNIQUE NOT NULL,
      duration_days INTEGER NOT NULL DEFAULT 30,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at  DATETIME NOT NULL,
      used        INTEGER DEFAULT 0,
      used_by     TEXT DEFAULT NULL,
      used_at     DATETIME DEFAULT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      email             TEXT UNIQUE NOT NULL,
      device_fingerprint TEXT NOT NULL,
      access_token_id   INTEGER REFERENCES access_tokens(id),
      access_expires_at DATETIME NOT NULL,
      is_active         INTEGER DEFAULT 1,
      created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS magic_links (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      token      TEXT UNIQUE NOT NULL,
      email      TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      used       INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_token      TEXT UNIQUE NOT NULL,
      device_fingerprint TEXT NOT NULL,
      expires_at         DATETIME NOT NULL,
      created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_seen          DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

// ── Helpers ──────────────────────────────────────────────────────────────

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

function now() {
  return new Date().toISOString();
}

function addDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function isExpired(dateStr) {
  return new Date(dateStr) < new Date();
}

async function sendMagicEmail(to, link) {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || user || 'Sharely <noreply@sharely.app>';

  if (!host || !user || !pass) return false; // email not configured — caller shows link

  const transporter = nodemailer.createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user, pass },
  });

  await transporter.sendMail({
    from,
    to,
    subject: 'Your Sharely login link',
    html: `
      <div style="font-family:Inter,sans-serif;max-width:480px;margin:0 auto;background:#0f0f1a;padding:32px;border-radius:16px;color:#fff">
        <h2 style="color:#a29bfe;margin-top:0">Your Sharely login link</h2>
        <p>Click the button below to log in. This link expires in 15 minutes and can only be used once.</p>
        <a href="${link}" style="display:inline-block;padding:14px 28px;background:linear-gradient(135deg,#6c5ce7,#a29bfe);color:#fff;border-radius:12px;text-decoration:none;font-weight:700;margin:20px 0">
          Log in to Sharely
        </a>
        <p style="color:#888;font-size:12px">Or copy this URL:<br>${link}</p>
        <p style="color:#555;font-size:11px">If you didn't request this, ignore this email.</p>
      </div>
    `,
  });
  return true;
}

function requireUserSession(req, res, next) {
  const token = req.cookies && req.cookies.sharely_user_session;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  const session = db.prepare('SELECT * FROM user_sessions WHERE session_token = ?').get(token);
  if (!session || isExpired(session.expires_at)) return res.status(401).json({ error: 'Session expired' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id);
  if (!user || !user.is_active) return res.status(403).json({ error: 'Account disabled' });
  if (isExpired(user.access_expires_at)) return res.status(403).json({ error: 'Access expired' });
  req.currentUser = user;
  req.currentSession = session;
  next();
}

// ── User Auth Routes ──────────────────────────────────────────────────────

/**
 * POST /auth/register
 * Body: { email, token, deviceFingerprint }
 */
router.post('/auth/register', (req, res) => {
  const { email, token, deviceFingerprint } = req.body;
  if (!email || !token || !deviceFingerprint) {
    return res.status(400).json({ error: 'email, token, and deviceFingerprint are required' });
  }

  const normalizedEmail = email.toLowerCase().trim();

  // Check token
  const accessToken = db.prepare('SELECT * FROM access_tokens WHERE token = ?').get(token.trim());
  if (!accessToken) return res.status(400).json({ error: 'Invalid access token' });
  if (accessToken.used) return res.status(400).json({ error: 'Access token already used' });
  if (isExpired(accessToken.expires_at)) return res.status(400).json({ error: 'Access token has expired' });

  // Check if email already registered
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (existing) return res.status(400).json({ error: 'Email already registered. Use magic login.' });

  // Create user
  const accessExpiresAt = accessToken.expires_at;
  const userResult = db.prepare(
    'INSERT INTO users (email, device_fingerprint, access_token_id, access_expires_at) VALUES (?, ?, ?, ?)'
  ).run(normalizedEmail, deviceFingerprint, accessToken.id, accessExpiresAt);

  // Mark token as used
  db.prepare('UPDATE access_tokens SET used = 1, used_by = ?, used_at = ? WHERE id = ?')
    .run(normalizedEmail, now(), accessToken.id);

  res.json({ success: true, message: 'Account created. Use magic login to sign in.' });
});

/**
 * POST /auth/magic-login
 * Body: { email, deviceFingerprint }
 */
router.post('/auth/magic-login', async (req, res) => {
  const { email, deviceFingerprint } = req.body;
  if (!email) return res.status(400).json({ error: 'email is required' });

  const normalizedEmail = email.toLowerCase().trim();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail);
  if (!user) return res.status(404).json({ error: 'No account found with this email. Please register first.' });
  if (!user.is_active) return res.status(403).json({ error: 'Account has been disabled.' });
  if (isExpired(user.access_expires_at)) return res.status(403).json({ error: 'Your access has expired.' });

  // Device check — if fingerprint provided, validate it matches
  if (deviceFingerprint && user.device_fingerprint !== deviceFingerprint) {
    return res.status(403).json({
      error: 'Login denied: this account is bound to a different device. Contact admin to reset.',
      device_mismatch: true,
    });
  }

  // Generate magic link token (15 min)
  const mlToken = randomToken(24);
  const mlExpiry = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO magic_links (token, email, expires_at) VALUES (?, ?, ?)').run(mlToken, normalizedEmail, mlExpiry);

  const baseUrl = process.env.BASE_URL ||
    (req.headers['x-forwarded-proto'] ? `${req.headers['x-forwarded-proto']}://${req.headers['host']}` : `http://${req.headers.host}`);
  const link = `${baseUrl}/auth/magic/${mlToken}`;

  const emailSent = await sendMagicEmail(normalizedEmail, link).catch(() => false);

  res.json({
    success: true,
    email_sent: emailSent,
    // Return link if email not configured (dev/testing mode)
    ...(emailSent ? {} : { magic_link: link, note: 'Email not configured — use this link directly' }),
  });
});

/**
 * GET /auth/magic/:token
 * Verifies magic link and creates a user session
 */
router.get('/auth/magic/:token', (req, res) => {
  const { token } = req.params;
  const deviceFingerprint = req.headers['x-device-fingerprint'] || req.query.fp || '';

  const ml = db.prepare('SELECT * FROM magic_links WHERE token = ?').get(token);
  if (!ml) return res.redirect('/user-login?error=invalid_link');
  if (ml.used) return res.redirect('/user-login?error=link_used');
  if (isExpired(ml.expires_at)) return res.redirect('/user-login?error=link_expired');

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(ml.email);
  if (!user || !user.is_active) return res.redirect('/user-login?error=account_disabled');
  if (isExpired(user.access_expires_at)) return res.redirect('/user-login?error=access_expired');

  // Mark magic link as used
  db.prepare('UPDATE magic_links SET used = 1 WHERE id = ?').run(ml.id);

  // Kill any existing sessions for this user (1 active session rule)
  db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(user.id);

  // Create new session (30 days)
  const sessionToken = randomToken(32);
  const sessionExpiry = addDays(30);
  const fingerprint = deviceFingerprint || user.device_fingerprint;
  db.prepare(
    'INSERT INTO user_sessions (user_id, session_token, device_fingerprint, expires_at) VALUES (?, ?, ?, ?)'
  ).run(user.id, sessionToken, fingerprint, sessionExpiry);

  // Update user's device fingerprint if different (first login after registration)
  if (fingerprint && user.device_fingerprint !== fingerprint) {
    db.prepare('UPDATE users SET device_fingerprint = ? WHERE id = ?').run(fingerprint, user.id);
  }

  res.cookie('sharely_user_session', sessionToken, {
    httpOnly: true,
    secure: req.headers['x-forwarded-proto'] === 'https',
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: '/',
  });

  res.redirect('/app');
});

/**
 * POST /auth/verify-session
 * Body: { deviceFingerprint }
 * Returns: { valid, user: { email, access_expires_at } }
 */
router.post('/auth/verify-session', requireUserSession, (req, res) => {
  const { deviceFingerprint } = req.body;
  const session = req.currentSession;
  const user = req.currentUser;

  // Strict device check
  if (deviceFingerprint && session.device_fingerprint && session.device_fingerprint !== deviceFingerprint) {
    db.prepare('DELETE FROM user_sessions WHERE id = ?').run(session.id);
    return res.status(403).json({ valid: false, error: 'Device mismatch — session terminated.' });
  }

  // Update last_seen
  db.prepare('UPDATE user_sessions SET last_seen = ? WHERE id = ?').run(now(), session.id);

  res.json({
    valid: true,
    user: { email: user.email, access_expires_at: user.access_expires_at },
  });
});

/**
 * POST /auth/logout
 */
router.post('/auth/logout', requireUserSession, (req, res) => {
  db.prepare('DELETE FROM user_sessions WHERE id = ?').run(req.currentSession.id);
  res.clearCookie('sharely_user_session');
  res.json({ success: true });
});

// ── Admin Routes ──────────────────────────────────────────────────────────

function requireAdminSession(req, res, next) {
  if (req.session && req.session.userId) return next();
  return res.status(401).json({ error: 'Admin authentication required' });
}

/**
 * POST /admin/generate-tokens
 * Body: { count, durationDays }
 */
router.post('/admin/generate-tokens', requireAdminSession, (req, res) => {
  const { count = 10, durationDays = 30 } = req.body;
  const n = Math.min(Math.max(parseInt(count) || 10, 1), 500);
  const days = parseInt(durationDays) || 30;
  const expiresAt = addDays(days);

  const insert = db.prepare(
    'INSERT INTO access_tokens (token, duration_days, expires_at) VALUES (?, ?, ?)'
  );
  const generate = db.transaction(() => {
    const tokens = [];
    for (let i = 0; i < n; i++) {
      const t = randomToken(16); // 32-char hex
      insert.run(t, days, expiresAt);
      tokens.push(t);
    }
    return tokens;
  });

  const tokens = generate();
  res.json({ success: true, count: tokens.length, tokens });
});

/**
 * GET /admin/tokens
 */
router.get('/admin/tokens', requireAdminSession, (req, res) => {
  const tokens = db.prepare(`
    SELECT id, token, duration_days, created_at, expires_at,
           used, used_by, used_at,
           CASE WHEN datetime(expires_at) < datetime('now') THEN 1 ELSE 0 END as is_expired
    FROM access_tokens
    ORDER BY created_at DESC
  `).all();
  res.json(tokens);
});

/**
 * DELETE /admin/tokens/:id
 */
router.delete('/admin/tokens/:id', requireAdminSession, (req, res) => {
  db.prepare('DELETE FROM access_tokens WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

/**
 * GET /admin/users
 */
router.get('/admin/users', requireAdminSession, (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.email, u.device_fingerprint, u.is_active, u.access_expires_at, u.created_at,
           at.token as access_token,
           CASE WHEN datetime(u.access_expires_at) < datetime('now') THEN 1 ELSE 0 END as is_expired,
           (SELECT last_seen FROM user_sessions WHERE user_id = u.id ORDER BY last_seen DESC LIMIT 1) as last_seen
    FROM users u
    LEFT JOIN access_tokens at ON at.id = u.access_token_id
    ORDER BY u.created_at DESC
  `).all();
  res.json(users);
});

/**
 * DELETE /admin/users/:id  — revoke user
 */
router.delete('/admin/users/:id', requireAdminSession, (req, res) => {
  db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(req.params.id);
  db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(req.params.id);
  res.json({ success: true });
});

/**
 * POST /admin/users/:id/restore
 */
router.post('/admin/users/:id/restore', requireAdminSession, (req, res) => {
  db.prepare('UPDATE users SET is_active = 1 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

/**
 * DELETE /admin/users/:id/device  — reset device binding
 */
router.delete('/admin/users/:id/device', requireAdminSession, (req, res) => {
  db.prepare("UPDATE users SET device_fingerprint = '' WHERE id = ?").run(req.params.id);
  db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(req.params.id);
  res.json({ success: true });
});

/**
 * GET /admin/analytics
 */
router.get('/admin/analytics', requireAdminSession, (req, res) => {
  const totalUsers = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  const activeUsers = db.prepare("SELECT COUNT(*) as c FROM users WHERE is_active = 1 AND datetime(access_expires_at) > datetime('now')").get().c;
  const expiredUsers = db.prepare("SELECT COUNT(*) as c FROM users WHERE datetime(access_expires_at) < datetime('now')").get().c;
  const totalTokens = db.prepare('SELECT COUNT(*) as c FROM access_tokens').get().c;
  const usedTokens = db.prepare('SELECT COUNT(*) as c FROM access_tokens WHERE used = 1').get().c;
  const expiredTokens = db.prepare("SELECT COUNT(*) as c FROM access_tokens WHERE used = 0 AND datetime(expires_at) < datetime('now')").get().c;
  const activeSessions = db.prepare("SELECT COUNT(*) as c FROM user_sessions WHERE datetime(expires_at) > datetime('now')").get().c;

  res.json({ totalUsers, activeUsers, expiredUsers, totalTokens, usedTokens, expiredTokens, activeSessions });
});

module.exports = { router, init };
