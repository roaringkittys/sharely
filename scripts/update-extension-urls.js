#!/usr/bin/env node
/**
 * update-extension-urls.js
 *
 * Reads SERVER_URL from extension-config.js and patches DEFAULT_SERVER_URL in
 * each extension entry-point file so the value only ever needs to change in
 * one place.
 *
 * Usage:
 *   npm run update-extension-urls
 */

const fs = require('fs');
const path = require('path');

const { SERVER_URL } = require('../extension-config');

const TARGETS = [
  { file: 'extension/sharely-extension.js',  pattern: /^(const DEFAULT_SERVER_URL = ').+(';\s*)$/m },
  { file: 'extension-capture/popup.js',       pattern: /^(const DEFAULT_SERVER_URL = ').+(';\s*)$/m },
  { file: 'extension-admin/background.js',    pattern: /^(const DEFAULT_SERVER_URL = ').+(';\s*)$/m },
];

let anyFailed = false;

for (const { file, pattern } of TARGETS) {
  const filePath = path.resolve(__dirname, '..', file);

  if (!fs.existsSync(filePath)) {
    console.error(`✖  Not found: ${file}`);
    anyFailed = true;
    continue;
  }

  const original = fs.readFileSync(filePath, 'utf8');

  if (!pattern.test(original)) {
    console.error(`✖  Could not find DEFAULT_SERVER_URL line in: ${file}`);
    anyFailed = true;
    continue;
  }

  const updated = original.replace(pattern, `$1${SERVER_URL}$2`);

  if (updated === original) {
    console.log(`–  No change needed:  ${file}`);
  } else {
    fs.writeFileSync(filePath, updated, 'utf8');
    console.log(`✔  Updated:           ${file}`);
  }
}

if (anyFailed) {
  console.error('\nOne or more files could not be updated. Check the errors above.');
  process.exit(1);
} else {
  console.log(`\nAll extension files now point to: ${SERVER_URL}`);
}
