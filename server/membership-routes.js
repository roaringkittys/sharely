/**
 * Membership Platform routes — public landing/pricing/auth, member dashboard/checkout,
 * and admin CRUD for plans/products. Session namespace: req.session.memberId (separate
 * from the existing Sharely admin session req.session.userId).
 */

const path = require('path');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const express = require('express');
const { getProvider } = require('./membership-payments');

function init(app, db, publicDir) {
  const router = express.Router();
  const membershipPublicDir = path.join(publicDir, 'membership');

  function requireMember(req, res, next) {
    if (req.session && req.session.memberId) return next();
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Please log in' });
    return res.redirect('/membership/login');
  }

  function requireAdmin(req, res, next) {
    // Reuse existing Sharely admin session
    if (req.session && req.session.userId) return next();
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
    return res.redirect('/login');
  }

  // ── Static pages ─────────────────────────────────────────────────────────

  const pages = {
    '/membership': 'index.html',
    '/membership/pricing': 'pricing.html',
    '/membership/signup': 'signup.html',
    '/membership/login': 'login.html',
    '/membership/forgot-password': 'forgot-password.html',
    '/membership/reset-password': 'reset-password.html',
    '/membership/admin': 'admin.html',
  };
  for (const [route, file] of Object.entries(pages)) {
    router.get(route, (req, res) => res.sendFile(path.join(membershipPublicDir, file)));
  }

  const memberPages = {
    '/membership/dashboard': 'dashboard.html',
    '/membership/tools': 'tools.html',
    '/membership/billing': 'billing.html',
    '/membership/upgrade': 'upgrade.html',
    '/membership/checkout': 'checkout.html',
    '/membership/checkout/success': 'checkout-success.html',
    '/membership/checkout/failed': 'checkout-failed.html',
    '/membership/settings': 'settings.html',
  };
  for (const [route, file] of Object.entries(memberPages)) {
    router.get(route, requireMember, (req, res) => res.sendFile(path.join(membershipPublicDir, file)));
  }

  // ── Public API: plans & products ─────────────────────────────────────────

  router.get('/api/membership/plans', (req, res) => {
    const plans = db.prepare('SELECT * FROM plans WHERE active = 1 ORDER BY sort_order').all();
    res.json(plans.map(p => ({ ...p, features: JSON.parse(p.features_json || '[]') })));
  });

  router.get('/api/membership/products', (req, res) => {
    const products = db.prepare('SELECT * FROM products WHERE active = 1 ORDER BY name').all();
    res.json(products);
  });

  // ── Auth: signup / login / logout / password reset ───────────────────────

  router.post('/api/membership/signup', (req, res) => {
    const { name, email, password } = req.body || {};
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    const existing = db.prepare('SELECT id FROM members WHERE email = ?').get(email.toLowerCase());
    if (existing) return res.status(409).json({ error: 'An account with this email already exists' });

    const hash = bcrypt.hashSync(password, 10);
    const result = db.prepare('INSERT INTO members (email, password, name) VALUES (?, ?, ?)').run(
      email.toLowerCase(), hash, name
    );
    req.session.memberId = result.lastInsertRowid;
    res.json({ success: true, memberId: result.lastInsertRowid });
  });

  router.post('/api/membership/login', (req, res) => {
    const { email, password } = req.body || {};
    const member = db.prepare('SELECT * FROM members WHERE email = ?').get((email || '').toLowerCase());
    if (!member || !bcrypt.compareSync(password || '', member.password)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    if (member.status !== 'active') {
      return res.status(403).json({ error: 'This account is not active' });
    }
    req.session.memberId = member.id;
    res.json({ success: true });
  });

  router.post('/api/membership/logout', (req, res) => {
    req.session.memberId = null;
    res.json({ success: true });
  });

  router.post('/api/membership/forgot-password', (req, res) => {
    const { email } = req.body || {};
    const member = db.prepare('SELECT * FROM members WHERE email = ?').get((email || '').toLowerCase());
    // Always respond success to avoid leaking which emails are registered
    if (!member) return res.json({ success: true });

    const token = crypto.randomBytes(24).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    db.prepare('UPDATE members SET reset_token = ?, reset_expires = ? WHERE id = ?').run(token, expires, member.id);

    // Placeholder: in production this would send an email with the reset link.
    console.log(`[membership] Password reset link for ${member.email}: /membership/reset-password?token=${token}`);
    res.json({ success: true });
  });

  router.post('/api/membership/reset-password', (req, res) => {
    const { token, password } = req.body || {};
    if (!token || !password || password.length < 6) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    const member = db.prepare('SELECT * FROM members WHERE reset_token = ?').get(token);
    if (!member || new Date(member.reset_expires) < new Date()) {
      return res.status(400).json({ error: 'This reset link is invalid or has expired' });
    }
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE members SET password = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?').run(hash, member.id);
    res.json({ success: true });
  });

  // ── Member: profile / dashboard data ──────────────────────────────────────

  router.get('/api/membership/me', requireMember, (req, res) => {
    const member = db.prepare('SELECT id, email, name, status, created_at FROM members WHERE id = ?').get(req.session.memberId);
    if (!member) return res.status(404).json({ error: 'Member not found' });

    const subscription = db.prepare(`
      SELECT s.*, p.name as plan_name, p.price_cents, p.billing_interval, p.features_json
      FROM subscriptions s JOIN plans p ON s.plan_id = p.id
      WHERE s.member_id = ? AND s.status = 'active'
      ORDER BY s.created_at DESC LIMIT 1
    `).get(member.id);

    res.json({
      member,
      subscription: subscription ? { ...subscription, features: JSON.parse(subscription.features_json || '[]') } : null,
    });
  });

  router.post('/api/membership/settings', requireMember, (req, res) => {
    const { name, current_password, new_password } = req.body || {};
    const member = db.prepare('SELECT * FROM members WHERE id = ?').get(req.session.memberId);
    if (!member) return res.status(404).json({ error: 'Member not found' });

    if (name) db.prepare('UPDATE members SET name = ? WHERE id = ?').run(name, member.id);

    if (new_password) {
      if (!bcrypt.compareSync(current_password || '', member.password)) {
        return res.status(400).json({ error: 'Current password is incorrect' });
      }
      const hash = bcrypt.hashSync(new_password, 10);
      db.prepare('UPDATE members SET password = ? WHERE id = ?').run(hash, member.id);
    }
    res.json({ success: true });
  });

  router.get('/api/membership/my-tools', requireMember, (req, res) => {
    const subscription = db.prepare(`
      SELECT * FROM subscriptions WHERE member_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1
    `).get(req.session.memberId);
    if (!subscription) return res.json({ tools: [] });

    const tools = db.prepare(`
      SELECT pr.* FROM plan_products pp
      JOIN products pr ON pp.product_id = pr.id
      WHERE pp.plan_id = ? AND pr.active = 1
      ORDER BY pr.name
    `).all(subscription.plan_id);
    res.json({ tools });
  });

  router.get('/api/membership/billing-history', requireMember, (req, res) => {
    const records = db.prepare(`
      SELECT * FROM billing_records WHERE member_id = ? ORDER BY created_at DESC
    `).all(req.session.memberId);
    res.json(records);
  });

  // ── Checkout / subscription flow ─────────────────────────────────────────

  router.post('/api/membership/checkout', requireMember, (req, res) => {
    const { plan_id, card_number } = req.body || {};
    const plan = db.prepare('SELECT * FROM plans WHERE id = ? AND active = 1').get(plan_id);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    const provider = getProvider();
    provider.charge({ amountCents: plan.price_cents, cardNumber: card_number }).then(result => {
      const transaction = db.transaction(() => {
        if (result.success) {
          // Deactivate any existing active subscription, then create the new one
          db.prepare("UPDATE subscriptions SET status = 'canceled' WHERE member_id = ? AND status = 'active'").run(req.session.memberId);
          const periodEnd = new Date();
          periodEnd.setMonth(periodEnd.getMonth() + (plan.billing_interval === 'year' ? 12 : 1));
          const subResult = db.prepare(
            'INSERT INTO subscriptions (member_id, plan_id, status, current_period_end) VALUES (?, ?, ?, ?)'
          ).run(req.session.memberId, plan.id, 'active', periodEnd.toISOString());

          db.prepare(
            'INSERT INTO billing_records (member_id, subscription_id, amount_cents, status, provider, provider_ref) VALUES (?, ?, ?, ?, ?, ?)'
          ).run(req.session.memberId, subResult.lastInsertRowid, plan.price_cents, 'paid', provider.name, result.reference);

          return { success: true, subscriptionId: subResult.lastInsertRowid };
        } else {
          db.prepare(
            'INSERT INTO billing_records (member_id, subscription_id, amount_cents, status, provider, provider_ref) VALUES (?, ?, ?, ?, ?, ?)'
          ).run(req.session.memberId, null, plan.price_cents, 'failed', provider.name, null);
          return { success: false, error: result.error };
        }
      });

      const outcome = transaction();
      res.json(outcome);
    }).catch(err => {
      res.status(500).json({ error: err.message });
    });
  });

  // ── Admin: plans / products / members / subscriptions ────────────────────

  router.get('/api/membership/admin/overview', requireAdmin, (req, res) => {
    const memberCount = db.prepare('SELECT COUNT(*) as c FROM members').get().c;
    const activeSubCount = db.prepare("SELECT COUNT(*) as c FROM subscriptions WHERE status = 'active'").get().c;
    const mrrRow = db.prepare(`
      SELECT COALESCE(SUM(p.price_cents), 0) as total
      FROM subscriptions s JOIN plans p ON s.plan_id = p.id
      WHERE s.status = 'active' AND p.billing_interval = 'month'
    `).get();
    const totalRevenue = db.prepare("SELECT COALESCE(SUM(amount_cents), 0) as total FROM billing_records WHERE status = 'paid'").get().total;
    res.json({
      memberCount,
      activeSubCount,
      mrrCents: mrrRow.total,
      totalRevenueCents: totalRevenue,
    });
  });

  router.get('/api/membership/admin/members', requireAdmin, (req, res) => {
    const members = db.prepare(`
      SELECT m.id, m.email, m.name, m.status, m.created_at,
             s.status as subscription_status, p.name as plan_name
      FROM members m
      LEFT JOIN subscriptions s ON s.member_id = m.id AND s.status = 'active'
      LEFT JOIN plans p ON s.plan_id = p.id
      ORDER BY m.created_at DESC
    `).all();
    res.json(members);
  });

  router.post('/api/membership/admin/members/:id/status', requireAdmin, (req, res) => {
    const { status } = req.body || {};
    if (!['active', 'suspended'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
    db.prepare('UPDATE members SET status = ? WHERE id = ?').run(status, req.params.id);
    res.json({ success: true });
  });

  router.get('/api/membership/admin/plans', requireAdmin, (req, res) => {
    const plans = db.prepare('SELECT * FROM plans ORDER BY sort_order').all();
    res.json(plans.map(p => ({ ...p, features: JSON.parse(p.features_json || '[]') })));
  });

  router.post('/api/membership/admin/plans', requireAdmin, (req, res) => {
    const { name, price_cents, billing_interval, description, features, sort_order } = req.body || {};
    if (!name || price_cents === undefined) return res.status(400).json({ error: 'Name and price are required' });
    const result = db.prepare(
      'INSERT INTO plans (name, price_cents, billing_interval, description, features_json, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(name, price_cents, billing_interval || 'month', description || '', JSON.stringify(features || []), sort_order || 0);
    res.json({ success: true, id: result.lastInsertRowid });
  });

  router.put('/api/membership/admin/plans/:id', requireAdmin, (req, res) => {
    const { name, price_cents, billing_interval, description, features, active, sort_order } = req.body || {};
    db.prepare(`
      UPDATE plans SET name = ?, price_cents = ?, billing_interval = ?, description = ?, features_json = ?, active = ?, sort_order = ?
      WHERE id = ?
    `).run(name, price_cents, billing_interval, description, JSON.stringify(features || []), active ? 1 : 0, sort_order || 0, req.params.id);
    res.json({ success: true });
  });

  router.delete('/api/membership/admin/plans/:id', requireAdmin, (req, res) => {
    db.prepare('DELETE FROM plans WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  });

  router.get('/api/membership/admin/products', requireAdmin, (req, res) => {
    const products = db.prepare('SELECT * FROM products ORDER BY name').all();
    res.json(products);
  });

  router.post('/api/membership/admin/products', requireAdmin, (req, res) => {
    const { name, description, icon, category } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Name is required' });
    const result = db.prepare(
      'INSERT INTO products (name, description, icon, category) VALUES (?, ?, ?, ?)'
    ).run(name, description || '', icon || '🧰', category || 'general');
    res.json({ success: true, id: result.lastInsertRowid });
  });

  router.put('/api/membership/admin/products/:id', requireAdmin, (req, res) => {
    const { name, description, icon, category, active } = req.body || {};
    db.prepare('UPDATE products SET name = ?, description = ?, icon = ?, category = ?, active = ? WHERE id = ?').run(
      name, description, icon, category, active ? 1 : 0, req.params.id
    );
    res.json({ success: true });
  });

  router.delete('/api/membership/admin/products/:id', requireAdmin, (req, res) => {
    db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  });

  router.get('/api/membership/admin/plans/:id/products', requireAdmin, (req, res) => {
    const productIds = db.prepare('SELECT product_id FROM plan_products WHERE plan_id = ?').all(req.params.id).map(r => r.product_id);
    res.json(productIds);
  });

  router.post('/api/membership/admin/plans/:id/products', requireAdmin, (req, res) => {
    const { product_ids } = req.body || {};
    const transaction = db.transaction(() => {
      db.prepare('DELETE FROM plan_products WHERE plan_id = ?').run(req.params.id);
      const insert = db.prepare('INSERT INTO plan_products (plan_id, product_id) VALUES (?, ?)');
      for (const pid of (product_ids || [])) insert.run(req.params.id, pid);
    });
    transaction();
    res.json({ success: true });
  });

  router.get('/api/membership/admin/subscriptions', requireAdmin, (req, res) => {
    const subs = db.prepare(`
      SELECT s.*, m.email as member_email, m.name as member_name, p.name as plan_name, p.price_cents
      FROM subscriptions s
      JOIN members m ON s.member_id = m.id
      JOIN plans p ON s.plan_id = p.id
      ORDER BY s.created_at DESC
    `).all();
    res.json(subs);
  });

  router.get('/api/membership/admin/billing', requireAdmin, (req, res) => {
    const records = db.prepare(`
      SELECT b.*, m.email as member_email
      FROM billing_records b JOIN members m ON b.member_id = m.id
      ORDER BY b.created_at DESC
    `).all();
    res.json(records);
  });

  app.use('/', router);
}

module.exports = { init };
