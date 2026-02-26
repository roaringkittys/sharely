const express = require('express');
const session = require('express-session');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const crypto = require('crypto');

const app = express();
const PORT = 5000;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

const dbPath = path.join(__dirname, 'data', 'sharely.db');
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
}
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    domain TEXT NOT NULL,
    icon TEXT DEFAULT '🌐',
    category TEXT DEFAULT 'other',
    enabled INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS cookies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_id INTEGER NOT NULL,
    label TEXT DEFAULT 'Default',
    cookie_name TEXT NOT NULL,
    cookie_value TEXT NOT NULL,
    cookie_domain TEXT NOT NULL,
    cookie_path TEXT DEFAULT '/',
    secure INTEGER DEFAULT 1,
    http_only INTEGER DEFAULT 0,
    same_site TEXT DEFAULT 'lax',
    expiry INTEGER DEFAULT 0,
    enabled INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS extension_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

const adminExists = db.prepare('SELECT COUNT(*) as count FROM admin_users').get();
if (adminExists.count === 0) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO admin_users (username, password) VALUES (?, ?)').run('admin', hash);
}

const settingsExist = db.prepare('SELECT COUNT(*) as count FROM extension_settings').get();
if (settingsExist.count === 0) {
  const defaults = [
    ['extension_name', 'Sharely'],
    ['extension_version', '1.0'],
    ['api_key', generateApiKey()],
    ['theme', 'dark'],
    ['auto_refresh', 'true'],
  ];
  const insert = db.prepare('INSERT OR IGNORE INTO extension_settings (key, value) VALUES (?, ?)');
  for (const [k, v] of defaults) insert.run(k, v);
}

const sampleServices = db.prepare('SELECT COUNT(*) as count FROM services').get();
if (sampleServices.count === 0) {
  const services = [
    ['ChatGPT', 'chatgpt.com', '🤖', 'productivity'],
    ['Netflix', 'www.netflix.com', '🎬', 'streaming'],
    ['Spotify', 'open.spotify.com', '🎵', 'streaming'],
    ['Canva', 'www.canva.com', '🎨', 'design'],
    ['Grammarly', 'app.grammarly.com', '📝', 'productivity'],
  ];
  const insert = db.prepare('INSERT INTO services (name, domain, icon, category) VALUES (?, ?, ?, ?)');
  for (const s of services) insert.run(...s);
}

function generateApiKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let key = 'sk_sharely_';
  for (let i = 0; i < 32; i++) key += chars.charAt(Math.floor(Math.random() * chars.length));
  return key;
}

app.use(cors());
app.use(express.json());
app.use(cookieParser());
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax'
  }
}));
app.use(express.static(path.join(__dirname, 'public')));

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
  res.redirect('/login');
}

function requireApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  const stored = db.prepare("SELECT value FROM extension_settings WHERE key = 'api_key'").get();
  if (apiKey && stored && apiKey === stored.value) return next();
  res.status(401).json({ error: 'Invalid API key' });
}

app.get('/login', (req, res) => {
  if (req.session && req.session.userId) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  req.session.userId = user.id;
  req.session.username = user.username;
  res.json({ success: true, username: user.username });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ username: req.session.username });
});

app.post('/api/auth/change-password', requireAuth, (req, res) => {
  const { current_password, new_password } = req.body;
  const user = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(req.session.userId);
  if (!bcrypt.compareSync(current_password, user.password)) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }
  const hash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE admin_users SET password = ? WHERE id = ?').run(hash, user.id);
  res.json({ success: true });
});

app.get('/api/services', requireAuth, (req, res) => {
  const services = db.prepare('SELECT * FROM services ORDER BY name').all();
  res.json(services);
});

app.post('/api/services', requireAuth, (req, res) => {
  const { name, domain, icon, category } = req.body;
  if (!name || !domain) return res.status(400).json({ error: 'Name and domain are required' });
  const result = db.prepare('INSERT INTO services (name, domain, icon, category) VALUES (?, ?, ?, ?)').run(name, domain, icon || '🌐', category || 'other');
  res.json({ id: result.lastInsertRowid, success: true });
});

app.put('/api/services/:id', requireAuth, (req, res) => {
  const { name, domain, icon, category, enabled } = req.body;
  db.prepare('UPDATE services SET name=?, domain=?, icon=?, category=?, enabled=? WHERE id=?').run(name, domain, icon, category, enabled ? 1 : 0, req.params.id);
  res.json({ success: true });
});

app.delete('/api/services/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM cookies WHERE service_id = ?').run(req.params.id);
  db.prepare('DELETE FROM services WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.get('/api/cookies', requireAuth, (req, res) => {
  const { service_id } = req.query;
  let cookies;
  if (service_id) {
    cookies = db.prepare('SELECT c.*, s.name as service_name, s.domain as service_domain FROM cookies c JOIN services s ON c.service_id = s.id WHERE c.service_id = ? ORDER BY c.cookie_name').all(service_id);
  } else {
    cookies = db.prepare('SELECT c.*, s.name as service_name, s.domain as service_domain FROM cookies c JOIN services s ON c.service_id = s.id ORDER BY s.name, c.cookie_name').all();
  }
  res.json(cookies);
});

app.post('/api/cookies', requireAuth, (req, res) => {
  const { service_id, label, cookie_name, cookie_value, cookie_domain, cookie_path, secure, http_only, same_site, expiry } = req.body;
  if (!service_id || !cookie_name || !cookie_value || !cookie_domain) {
    return res.status(400).json({ error: 'service_id, cookie_name, cookie_value, and cookie_domain are required' });
  }
  const result = db.prepare(
    'INSERT INTO cookies (service_id, label, cookie_name, cookie_value, cookie_domain, cookie_path, secure, http_only, same_site, expiry) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(service_id, label || 'Default', cookie_name, cookie_value, cookie_domain, cookie_path || '/', secure ? 1 : 0, http_only ? 1 : 0, same_site || 'lax', expiry || 0);
  res.json({ id: result.lastInsertRowid, success: true });
});

app.put('/api/cookies/:id', requireAuth, (req, res) => {
  const { label, cookie_name, cookie_value, cookie_domain, cookie_path, secure, http_only, same_site, expiry, enabled } = req.body;
  db.prepare(
    'UPDATE cookies SET label=?, cookie_name=?, cookie_value=?, cookie_domain=?, cookie_path=?, secure=?, http_only=?, same_site=?, expiry=?, enabled=?, updated_at=CURRENT_TIMESTAMP WHERE id=?'
  ).run(label, cookie_name, cookie_value, cookie_domain, cookie_path, secure ? 1 : 0, http_only ? 1 : 0, same_site, expiry, enabled ? 1 : 0, req.params.id);
  res.json({ success: true });
});

app.delete('/api/cookies/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM cookies WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.get('/api/settings', requireAuth, (req, res) => {
  const settings = {};
  db.prepare('SELECT * FROM extension_settings').all().forEach(row => {
    settings[row.key] = row.value;
  });
  res.json(settings);
});

app.put('/api/settings', requireAuth, (req, res) => {
  const upsert = db.prepare('INSERT OR REPLACE INTO extension_settings (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(req.body)) {
    upsert.run(key, String(value));
  }
  res.json({ success: true });
});

app.post('/api/settings/regenerate-key', requireAuth, (req, res) => {
  const newKey = generateApiKey();
  db.prepare("INSERT OR REPLACE INTO extension_settings (key, value) VALUES ('api_key', ?)").run(newKey);
  res.json({ api_key: newKey });
});

app.get('/api/extension/config', requireApiKey, (req, res) => {
  const settings = {};
  db.prepare('SELECT * FROM extension_settings').all().forEach(row => {
    settings[row.key] = row.value;
  });
  const services = db.prepare('SELECT * FROM services WHERE enabled = 1 ORDER BY name').all();
  const cookies = db.prepare('SELECT c.*, s.domain as service_domain, s.name as service_name FROM cookies c JOIN services s ON c.service_id = s.id WHERE c.enabled = 1 AND s.enabled = 1').all();

  const serviceData = services.map(s => ({
    ...s,
    cookies: cookies.filter(c => c.service_id === s.id).map(c => ({
      name: c.cookie_name,
      value: c.cookie_value,
      domain: c.cookie_domain,
      path: c.cookie_path,
      secure: !!c.secure,
      httpOnly: !!c.http_only,
      sameSite: c.same_site,
      expirationDate: c.expiry || undefined,
    }))
  }));

  res.json({
    extension_name: settings.extension_name || 'Sharely',
    version: settings.extension_version || '1.0',
    theme: settings.theme || 'dark',
    services: serviceData,
  });
});

app.get('/api/stats', requireAuth, (req, res) => {
  const totalServices = db.prepare('SELECT COUNT(*) as count FROM services').get().count;
  const activeServices = db.prepare('SELECT COUNT(*) as count FROM services WHERE enabled = 1').get().count;
  const totalCookies = db.prepare('SELECT COUNT(*) as count FROM cookies').get().count;
  const activeCookies = db.prepare('SELECT COUNT(*) as count FROM cookies WHERE enabled = 1').get().count;
  const categories = db.prepare('SELECT category, COUNT(*) as count FROM services GROUP BY category').all();
  res.json({ totalServices, activeServices, totalCookies, activeCookies, categories });
});

app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/services', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/cookies', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/settings', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Sharely Admin Dashboard running on port ${PORT}`);
});
