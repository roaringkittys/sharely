const fs = require('fs');
const path = 'server/membership-routes.js';
let content = fs.readFileSync(path, 'utf8');

// 1. Insert CSRF middleware before "Member: profile" section
const anchor = '  // ── Member: profile / dashboard data ──────────────────────────────────────';
const csrfBlock = `  // ── CSRF protection for member-only state-changing routes ────────────────
  // Public routes (snap-token, transaction check, checkout-complete,
  // webhook, auth) are placed BEFORE this line. All routes after this
  // that are state-changing will have their Origin header validated.
  router.use(memberCsrf);

  // ── Member: profile / dashboard data ──────────────────────────────────────`;

if (!content.includes('router.use(memberCsrf)')) {
  content = content.replace(anchor, csrfBlock);
  console.log('Inserted memberCsrf middleware');
} else {
  console.log('memberCsrf already present');
}

fs.writeFileSync(path, content);
console.log('Done');
