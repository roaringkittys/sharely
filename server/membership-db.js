/**
 * Membership Platform — Database schema and seed data.
 * Separate namespace from Sharely's cookie/service tables:
 * members, plans, products, plan_products, subscriptions, billing_records.
 */

function init(db) {
  // Migration: add access_token if missing (table may exist from earlier version)
  try {
    db.exec('ALTER TABLE members ADD COLUMN access_token TEXT DEFAULT NULL');
  } catch (e) {
    // column already exists
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS members (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      email         TEXT UNIQUE NOT NULL,
      password      TEXT NOT NULL,
      name          TEXT NOT NULL,
      status        TEXT DEFAULT 'active',
      access_token  TEXT DEFAULT NULL,
      reset_token   TEXT DEFAULT NULL,
      reset_expires DATETIME DEFAULT NULL,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS plans (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      name             TEXT NOT NULL,
      price_cents      INTEGER NOT NULL DEFAULT 0,
      billing_interval TEXT NOT NULL DEFAULT 'month',
      description      TEXT DEFAULT '',
      features_json    TEXT DEFAULT '[]',
      active           INTEGER DEFAULT 1,
      sort_order       INTEGER DEFAULT 0,
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS products (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      description TEXT DEFAULT '',
      icon        TEXT DEFAULT '\u{1F9F0}',
      category    TEXT DEFAULT 'general',
      active      INTEGER DEFAULT 1,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS plan_products (
      plan_id    INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      PRIMARY KEY (plan_id, product_id)
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id          INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      plan_id            INTEGER NOT NULL REFERENCES plans(id),
      status             TEXT DEFAULT 'active',
      current_period_end DATETIME,
      created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS billing_records (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id      INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      subscription_id INTEGER REFERENCES subscriptions(id),
      amount_cents   INTEGER NOT NULL,
      status         TEXT NOT NULL DEFAULT 'paid',
      provider       TEXT DEFAULT 'mock',
      provider_ref   TEXT DEFAULT NULL,
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  seed(db);
}

function seed(db) {
  const planCount = db.prepare('SELECT COUNT(*) as c FROM plans').get().c;
  if (planCount === 0) {
    const insertPlan = db.prepare(
      'INSERT INTO plans (name, price_cents, billing_interval, description, features_json, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
    );
    insertPlan.run(
      'Starter', 900, 'month',
      'Essential tools bundle for individuals getting started.',
      JSON.stringify(['5 tool integrations', 'Email support', 'Monthly usage reports']),
      1
    );
    insertPlan.run(
      'Pro', 2900, 'month',
      'The full toolkit for professionals and power users.',
      JSON.stringify(['20 tool integrations', 'Priority support', 'Advanced analytics', 'Team seat (1 included)']),
      2
    );
    insertPlan.run(
      'Team', 7900, 'month',
      'Built for teams that need shared access and admin controls.',
      JSON.stringify(['Unlimited tool integrations', 'Dedicated support', 'Team seats (5 included)', 'Centralized billing', 'Admin controls']),
      3
    );
  }

  const productCount = db.prepare('SELECT COUNT(*) as c FROM products').get().c;
  if (productCount === 0) {
    const insertProduct = db.prepare(
      'INSERT INTO products (name, description, icon, category) VALUES (?, ?, ?, ?)'
    );
    const products = [
      ['Docs Suite', 'Collaborative document editing and templates.', '\u{1F4C4}', 'productivity'],
      ['Design Kit', 'Vector and raster design toolkit with asset library.', '\u{1F3A8}', 'design'],
      ['Analytics Hub', 'Dashboards and reporting for product metrics.', '\u{1F4CA}', 'analytics'],
      ['Code Assistant', 'AI-assisted coding and refactoring tool.', '\u{1F9E9}', 'development'],
      ['Automation Flow', 'No-code workflow automation builder.', '\u{1F501}', 'automation'],
      ['Video Studio', 'Cloud-based video editing and rendering.', '\u{1F3AC}', 'media'],
    ];
    for (const p of products) insertProduct.run(...p);

    // Link products to plans: Starter gets 2, Pro gets 4, Team gets all 6
    const plans = db.prepare('SELECT id, name FROM plans').all();
    const allProducts = db.prepare('SELECT id FROM products ORDER BY id').all();
    const linkStmt = db.prepare('INSERT OR IGNORE INTO plan_products (plan_id, product_id) VALUES (?, ?)');
    for (const plan of plans) {
      let count = plan.name === 'Starter' ? 2 : plan.name === 'Pro' ? 4 : allProducts.length;
      for (let i = 0; i < count; i++) linkStmt.run(plan.id, allProducts[i].id);
    }
  }
}

module.exports = { init };
