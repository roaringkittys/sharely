/**
 * Membership Platform routes — public landing/pricing/auth, member dashboard/checkout,
 * and admin CRUD for plans/products. Session namespace: req.session.memberId (separate
 * from the existing Sharely admin session req.session.userId).
 */

const path = require('path');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const express = require('express');
const payments = require('./membership-payments');

function init(app, db, publicDir) {
  const router = express.Router();
  const membershipPublicDir = path.join(publicDir, 'membership');

  // CORS helper for extension requests (credentialed fetch from chrome-extension://)
  function extCors(req, res, next) {
    const origin = req.headers.origin || '';
    if (origin.startsWith('chrome-extension://') || origin.startsWith('moz-extension://')) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
      res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  }

  function requireMember(req, res, next) {
    if (req.session && req.session.memberId) return next();
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Please log in' });
    return res.redirect('/membership/login');
  }

  function requireAdmin(req, res, next) {
    if (req.session && req.session.userId) return next();
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
    return res.redirect('/login');
  }

  // ── Static pages ─────────────────────────────────────────────────────────

  router.get('/membership', (req, res) => res.redirect('/membership/home'));

  const pages = {
    '/membership/home': 'home.html',
    '/membership/index.html': 'index.html',
    '/membership/pricing': 'pricing.html',
    '/membership/signup': 'signup.html',
    '/membership/login': 'login.html',
    '/membership/forgot-password': 'forgot-password.html',
    '/membership/reset-password': 'reset-password.html',
    '/membership/admin': 'admin.html',
    '/membership/checkout': 'checkout.html',
    '/membership/checkout/success': 'checkout-success.html',
    '/membership/checkout/failed': 'checkout-failed.html',
  };
  for (const [route, file] of Object.entries(pages)) {
    router.get(route, (req, res) => res.sendFile(path.join(membershipPublicDir, file)));
  }

  const memberPages = {
    '/membership/dashboard': 'dashboard.html',
    '/membership/tools': 'tools.html',
    '/membership/billing': 'billing.html',
    '/membership/upgrade': 'upgrade.html',
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

  // ── Midtrans config (client key for frontend) ────────────────────────────

  router.get('/api/membership/payment-config', (req, res) => {
    res.json({ clientKey: payments.getClientKey(), isProduction: payments.isProduction });
  });

  // ── Extension session check (called by Chrome extension with credentials:include) ─

  router.options('/api/membership/extension-session', extCors, (req, res) => res.sendStatus(204));
  router.get('/api/membership/extension-session', extCors, (req, res) => {
    if (!req.session || !req.session.memberId) {
      return res.json({ authenticated: false });
    }

    const member = db.prepare('SELECT id, email, name FROM members WHERE id = ? AND status != ?')
      .get(req.session.memberId, 'banned');
    if (!member) return res.json({ authenticated: false });

    const sub = db.prepare(
      `SELECT s.*, p.name as plan_name FROM subscriptions s
       JOIN plans p ON s.plan_id = p.id
       WHERE s.member_id = ? ORDER BY s.created_at DESC LIMIT 1`
    ).get(req.session.memberId);

    const isActive = sub && sub.status === 'active' && new Date(sub.current_period_end) >= new Date();
    let daysRemaining = 0;
    if (isActive) {
      daysRemaining = Math.max(0, Math.ceil(
        (new Date(sub.current_period_end) - new Date()) / (1000 * 60 * 60 * 24)
      ));
    }

    res.json({
      authenticated: true,
      user: { id: member.id, email: member.email, name: member.name },
      subscription: sub ? {
        active: isActive,
        plan: sub.plan_name,
        expires_at: sub.current_period_end,
        days_remaining: daysRemaining,
      } : null,
    });
  });

  // ── CSRF protection for state-changing member routes ──────────────────────
  // With SameSite=None on the session cookie, cross-site requests now include
  // the cookie. We mitigate CSRF by requiring Content-Type: application/json
  // (which browsers cannot forge cross-origin without a CORS preflight) and
  // by validating the Origin header on member session POST requests.
  function memberCsrf(req, res, next) {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      return next();
    }
    const origin = req.headers.origin;
    if (!origin) return next(); // Same-origin requests don't send Origin
    const isTrusted = origin.startsWith('chrome-extension://') ||
      origin.startsWith('moz-extension://') ||
      origin.includes(req.headers.host || '');
    if (!isTrusted) {
      return res.status(403).json({ error: 'CSRF check failed' });
    }
    next();
  }

  // ── Snap token creation (public — guest can pay before creating account) ─

  router.post('/api/membership/snap-token', async (req, res) => {
    try {
      const { plan_id, email, name } = req.body || {};
      if (!plan_id || !email) {
        return res.status(400).json({ error: 'Plan and email are required' });
      }
      const plan = db.prepare('SELECT * FROM plans WHERE id = ? AND active = 1').get(plan_id);
      if (!plan) return res.status(404).json({ error: 'Plan not found' });

      const orderId = 'SHRLY-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
      const amount = plan.price_cents;

      // If the member is already logged in, link the transaction to their account
      // so the subscription auto-activates when the webhook fires.
      const memberId = (req.session && req.session.memberId) || null;

      db.prepare(
        'INSERT INTO transactions (order_id, member_id, plan_id, amount_cents, status, customer_email, customer_name) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(orderId, memberId, plan.id, amount, 'pending', email.toLowerCase(), name || email.split('@')[0]);

      const snapResult = await payments.createSnapToken({
        orderId,
        amount,
        customerEmail: email.toLowerCase(),
        customerName: name || email.split('@')[0],
        planName: plan.name,
        items: [{
          id: 'plan-' + plan.id,
          price: amount,
          quantity: 1,
          name: plan.name + ' Plan',
        }],
      });

      res.json({
        token: snapResult.token,
        redirect_url: snapResult.redirect_url,
        order_id: snapResult.order_id,
      });
    } catch (err) {
      console.error('[snap-token]', err);
      res.status(500).json({ error: err.message || 'Failed to create payment token' });
    }
  });

  // ── Check transaction status ─────────────────────────────────────────────

  router.get('/api/membership/transaction/:orderId', async (req, res) => {
    try {
      const localTx = db.prepare('SELECT * FROM transactions WHERE order_id = ?').get(req.params.orderId);
      if (!localTx) return res.status(404).json({ error: 'Transaction not found' });

      // If already settled locally, return immediately
      if (localTx.status === 'paid') {
        return res.json({ status: 'paid', order_id: req.params.orderId, plan_id: localTx.plan_id, customer_email: localTx.customer_email || null });
      }

      // Otherwise check Midtrans (404 = transaction not yet created on their side)
      let remoteStatus;
      try {
        remoteStatus = await payments.checkTransaction(req.params.orderId);
      } catch (err) {
        const is404 = err.httpStatusCode === '404' || (err.ApiResponse && err.ApiResponse.status_code === '404');
        if (is404) {
          return res.json({ status: 'pending', order_id: req.params.orderId, plan_id: localTx.plan_id });
        }
        throw err;
      }
      const isPaid = remoteStatus.transaction_status === 'settlement' || remoteStatus.transaction_status === 'capture';
      const isFailed = ['deny', 'cancel', 'expire', 'failure'].includes(remoteStatus.transaction_status);

      if (isPaid) {
        db.prepare("UPDATE transactions SET status = 'paid', midtrans_status = ?, updated_at = datetime('now') WHERE order_id = ?")
          .run(remoteStatus.transaction_status, req.params.orderId);
      } else if (isFailed) {
        db.prepare("UPDATE transactions SET status = 'failed', midtrans_status = ?, updated_at = datetime('now') WHERE order_id = ?")
          .run(remoteStatus.transaction_status, req.params.orderId);
      }

      res.json({
        status: isPaid ? 'paid' : isFailed ? 'failed' : 'pending',
        order_id: req.params.orderId,
        plan_id: localTx.plan_id,
        customer_email: localTx.customer_email || null,
        midtrans_status: remoteStatus.transaction_status,
      });
    } catch (err) {
      console.error('[transaction-check]', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Complete checkout after payment (create account + activate subscription) ─

  router.post('/api/membership/checkout-complete', async (req, res) => {
    const { order_id, name, password } = req.body || {};
    if (!order_id) {
      return res.status(400).json({ error: 'Order ID is required' });
    }

    const tx = db.prepare('SELECT * FROM transactions WHERE order_id = ?').get(order_id);
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    if (tx.status !== 'paid') return res.status(400).json({ error: 'Payment not yet confirmed' });

    const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(tx.plan_id);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    // Already logged in → just activate subscription, skip account creation
    const sessionMemberId = req.session && req.session.memberId;
    if (sessionMemberId) {
      db.prepare("UPDATE subscriptions SET status = 'canceled' WHERE member_id = ? AND status = 'active'").run(sessionMemberId);
      const periodEnd = new Date();
      periodEnd.setDate(periodEnd.getDate() + (plan.duration_days || 30));
      const subResult = db.prepare(
        'INSERT INTO subscriptions (member_id, plan_id, status, current_period_end) VALUES (?, ?, ?, ?)'
      ).run(sessionMemberId, plan.id, 'active', periodEnd.toISOString());
      db.prepare(
        'INSERT INTO billing_records (member_id, subscription_id, amount_cents, status, provider, provider_ref) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(sessionMemberId, subResult.lastInsertRowid, plan.price_cents, 'paid', 'midtrans', order_id);
      return res.json({ success: true, memberId: sessionMemberId, subscriptionId: subResult.lastInsertRowid });
    }

    // Transaction already linked to a member (e.g. by webhook) → activate for that member
    if (tx.member_id) {
      db.prepare("UPDATE subscriptions SET status = 'canceled' WHERE member_id = ? AND status = 'active'").run(tx.member_id);
      const periodEnd = new Date();
      periodEnd.setDate(periodEnd.getDate() + (plan.duration_days || 30));
      const subResult = db.prepare(
        'INSERT INTO subscriptions (member_id, plan_id, status, current_period_end) VALUES (?, ?, ?, ?)'
      ).run(tx.member_id, plan.id, 'active', periodEnd.toISOString());
      db.prepare(
        'INSERT INTO billing_records (member_id, subscription_id, amount_cents, status, provider, provider_ref) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(tx.member_id, subResult.lastInsertRowid, plan.price_cents, 'paid', 'midtrans', order_id);
      req.session.memberId = tx.member_id;
      return res.json({ success: true, memberId: tx.member_id, subscriptionId: subResult.lastInsertRowid });
    }

    // Guest flow: require name and password to create account
    if (!name || !password) {
      return res.status(400).json({ error: 'Name and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    let memberId = null;
    let email = '';

    email = (req.body.email || '').toLowerCase();
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const existing = db.prepare('SELECT id FROM members WHERE email = ?').get(email);
    if (existing) {
      memberId = existing.id;
    } else {
      const hash = bcrypt.hashSync(password, 10);
      const result = db.prepare('INSERT INTO members (email, password, name, status) VALUES (?, ?, ?, ?)')
        .run(email, hash, name, 'active');
      memberId = result.lastInsertRowid;
    }
    db.prepare('UPDATE transactions SET member_id = ? WHERE order_id = ?').run(memberId, order_id);

    const member = db.prepare('SELECT * FROM members WHERE id = ?').get(memberId);
    if (!member) return res.status(404).json({ error: 'Member not found' });

    // Activate subscription
    db.prepare("UPDATE subscriptions SET status = 'canceled' WHERE member_id = ? AND status = 'active'").run(memberId);
    const periodEnd = new Date();
    periodEnd.setDate(periodEnd.getDate() + (plan.duration_days || 30));
    const subResult = db.prepare(
      'INSERT INTO subscriptions (member_id, plan_id, status, current_period_end) VALUES (?, ?, ?, ?)'
    ).run(memberId, plan.id, 'active', periodEnd.toISOString());

    db.prepare(
      'INSERT INTO billing_records (member_id, subscription_id, amount_cents, status, provider, provider_ref) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(memberId, subResult.lastInsertRowid, plan.price_cents, 'paid', 'midtrans', order_id);

    req.session.memberId = memberId;
    res.json({ success: true, memberId, subscriptionId: subResult.lastInsertRowid });
  });

  // ── Midtrans webhook ─────────────────────────────────────────────────────

  router.post('/api/membership/midtrans-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    try {
      const payload = JSON.parse(req.body);
      const { order_id, status_code, gross_amount, signature_key, transaction_status } = payload;

      if (!order_id || !signature_key) {
        return res.status(400).json({ error: 'Missing fields' });
      }

      // Verify signature
      if (!payments.verifySignature(order_id, status_code, gross_amount, signature_key)) {
        console.warn('[webhook] Signature mismatch for order', order_id);
        return res.status(403).json({ error: 'Invalid signature' });
      }

      const localTx = db.prepare('SELECT * FROM transactions WHERE order_id = ?').get(order_id);
      if (!localTx) {
        console.warn('[webhook] Unknown order', order_id);
        return res.status(404).json({ error: 'Transaction not found' });
      }

      const isPaid = transaction_status === 'settlement' || transaction_status === 'capture';
      const isFailed = ['deny', 'cancel', 'expire', 'failure'].includes(transaction_status);

      if (isPaid) {
        db.prepare(
          "UPDATE transactions SET status = 'paid', midtrans_status = ?, midtrans_response = ?, updated_at = datetime('now') WHERE order_id = ?"
        ).run(transaction_status, JSON.stringify(payload), order_id);

        // If member already linked (e.g., existing user upgrading), auto-activate subscription
        if (localTx.member_id) {
          const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(localTx.plan_id);
          if (plan) {
            db.prepare("UPDATE subscriptions SET status = 'canceled' WHERE member_id = ? AND status = 'active'").run(localTx.member_id);
            const periodEnd = new Date();
            const durationDays = plan.duration_days || 30;
            periodEnd.setDate(periodEnd.getDate() + durationDays);
            const subResult = db.prepare(
              'INSERT INTO subscriptions (member_id, plan_id, status, current_period_end) VALUES (?, ?, ?, ?)'
            ).run(localTx.member_id, plan.id, 'active', periodEnd.toISOString());
            db.prepare(
              'INSERT INTO billing_records (member_id, subscription_id, amount_cents, status, provider, provider_ref) VALUES (?, ?, ?, ?, ?, ?)'
            ).run(localTx.member_id, subResult.lastInsertRowid, plan.price_cents, 'paid', 'midtrans', order_id);
          }
        }
      } else if (isFailed) {
        db.prepare(
          "UPDATE transactions SET status = 'failed', midtrans_status = ?, midtrans_response = ?, updated_at = datetime('now') WHERE order_id = ?"
        ).run(transaction_status, JSON.stringify(payload), order_id);
      }

      res.json({ received: true });
    } catch (err) {
      console.error('[webhook]', err);
      res.status(500).json({ error: err.message });
    }
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
    if (!member) return res.json({ success: true });

    const token = crypto.randomBytes(24).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    db.prepare('UPDATE members SET reset_token = ?, reset_expires = ? WHERE id = ?').run(token, expires, member.id);
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
      return res.status(400).json({ error: 'This reset link has expired' });
    }
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE members SET password = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?').run(hash, member.id);
    res.json({ success: true });
  });

  // ── CSRF protection for member-only state-changing routes ────────────────
  // Public routes (snap-token, transaction check, checkout-complete,
  // webhook, auth) are placed BEFORE this line. All routes after this
  // that are state-changing will have their Origin header validated.
  router.use(memberCsrf);

  // ── Member: profile / dashboard data ──────────────────────────────────────

  router.get('/api/membership/me', requireMember, (req, res) => {
    let member = db.prepare('SELECT id, email, name, status, access_token, created_at FROM members WHERE id = ?').get(req.session.memberId);
    if (!member) return res.status(404).json({ error: 'Member not found' });

    // Auto-generate access token on first login if missing
    if (!member.access_token) {
      const token = crypto.randomBytes(24).toString('hex');
      db.prepare('UPDATE members SET access_token = ? WHERE id = ?').run(token, member.id);
      member = { ...member, access_token: token };
    }

    const subscription = db.prepare(`
      SELECT s.*, p.name as plan_name, p.price_cents, p.billing_interval, p.duration_days, p.features_json
      FROM subscriptions s JOIN plans p ON s.plan_id = p.id
      WHERE s.member_id = ? AND s.status = 'active'
      ORDER BY s.created_at DESC LIMIT 1
    `).get(member.id);

    res.json({
      member,
      subscription: subscription ? { ...subscription, features: JSON.parse(subscription.features_json || '[]') } : null,
    });
  });

  router.post('/api/membership/token', requireMember, (req, res) => {
    const token = crypto.randomBytes(24).toString('hex');
    db.prepare('UPDATE members SET access_token = ? WHERE id = ?').run(token, req.session.memberId);
    res.json({ success: true, token });
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
    res.json({ memberCount, activeSubCount, mrrCents: mrrRow.total, totalRevenueCents: totalRevenue });
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

  // ── Extension download (zipped) ───────────────────────────────────────────────────

  const { execSync } = require('child_process');
  const fs = require('fs');

  router.get('/api/membership/download-extension', (req, res) => {
    const extDir = path.join(__dirname, '..', 'extension');
    if (!fs.existsSync(extDir)) return res.status(404).json({ error: 'Extension not found' });
    const zipPath = path.join('/tmp', 'sharely-extension.zip');
    try {
      execSync(`zip -r "${zipPath}" .`, { cwd: extDir, stdio: 'pipe' });
      res.download(zipPath, 'sharely-extension.zip', (err) => {
        if (!err) fs.unlink(zipPath, () => {});
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to package extension' });
    }
  });

  app.use('/', router);
}

module.exports = { init };
