/**
 * extension-config.js — single source of truth for extension server URL
 *
 * Before packaging any extension for distribution, set SERVER_URL to your
 * deployed server address, then run:
 *
 *   npm run update-extension-urls
 *
 * This will patch DEFAULT_SERVER_URL in all three extension entry-point files:
 *   - extension/sharely-extension.js
 *   - extension-capture/popup.js
 *   - extension-admin/background.js
 */

module.exports = {
  // ── Change this URL before distributing extensions ──────────────────────────
  SERVER_URL: 'https://6cbfb053-e399-4cf0-a649-373f485ef582-00-386xnci2vytem.pike.replit.dev',
  // ────────────────────────────────────────────────────────────────────────────
};
