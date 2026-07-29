#!/usr/bin/env node
/*
 * Build and validate the Orion package without copying the extension directory
 * into the archive. Requires only Node.js and the system zip/unzip commands.
 * Supports MV3 (service_worker) — the structure Orion iOS actually accepts.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root   = path.resolve(__dirname, '..');
const source = path.join(root, 'extension-orion');
const dist   = path.join(root, 'dist');
const output = path.join(dist, 'sharely-orion.zip');

const required = ['manifest.json', 'index.html', 'background.js'];
const forbidden = /(^|\/)(__MACOSX|\.git|node_modules)(\/|$)|(^|\/)\.DS_Store$/;

function fail(message) {
  console.error(`Orion build validation failed: ${message}`);
  process.exit(1);
}

function readManifest() {
  const manifestPath = path.join(source, 'manifest.json');
  if (!fs.existsSync(manifestPath)) fail('manifest.json is missing');
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
  catch (e) { fail(`manifest.json is not valid JSON: ${e.message}`); }

  const mv = manifest.manifest_version;
  if (mv !== 2 && mv !== 3) fail(`manifest_version must be 2 or 3, got: ${mv}`);

  if (mv === 3) {
    if (!manifest.background || !manifest.background.service_worker) {
      fail('MV3 manifest must have background.service_worker');
    }
    if (!manifest.action) fail('MV3 manifest must use "action", not "browser_action"');
    if (manifest.browser_action) fail('MV3 manifest must not have "browser_action"');
    } else {
    if (!manifest.background || !Array.isArray(manifest.background.scripts)) {
      fail('MV2 manifest must have background.scripts array');
    }
  }
  return manifest;
}

function sourceFiles() {
  for (const file of required) {
    if (!fs.existsSync(path.join(source, file))) fail(`required runtime file missing: ${file}`);
  }
  const entries = fs.readdirSync(source, { withFileTypes: true });
  for (const e of entries) {
    if (forbidden.test(e.name)) fail(`forbidden source entry: ${e.name}`);
  }
}

function archiveEntries() {
  let listing;
  try {
    listing = execFileSync('unzip', ['-Z1', output], { encoding: 'utf8' })
      .split(/\r?\n/).filter(Boolean);
  } catch (e) { fail(`could not inspect ZIP: ${e.message}`); }

  if (!listing.includes('manifest.json')) fail('manifest.json is not at ZIP root');
  // Allow icons/ subdirectory — only flag other wrapper-style paths
  if (listing.some(name => forbidden.test(name))) {
    fail('ZIP contains forbidden metadata or dependency');
  }
  for (const file of required) {
    if (!listing.includes(file)) fail(`ZIP is missing ${file}`);
  }
  return listing;
}

function collectFiles(dir, base) {
  const results = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (forbidden.test(e.name)) continue;
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) results.push(...collectFiles(path.join(dir, e.name), rel));
    else results.push(rel);
  }
  return results;
}

function validate() {
  readManifest();
  sourceFiles();
  if (!fs.existsSync(output)) fail(`ZIP does not exist: ${path.relative(root, output)}`);
  const listing = archiveEntries();
  console.log(`Validated ${path.relative(root, output)} (${listing.length} entries)`);
  listing.forEach(f => console.log(' ', f));
}

function build() {
  readManifest();
  sourceFiles();
  fs.mkdirSync(dist, { recursive: true });
  if (fs.existsSync(output)) fs.unlinkSync(output);
  const files = collectFiles(source, '');
  try {
    execFileSync('zip', ['-q', '-X', output, ...files], { cwd: source, stdio: 'inherit' });
  } catch (e) { fail(`zip command failed: ${e.message}`); }
  archiveEntries();
  console.log(`Built ${path.relative(root, output)}`);
}

if (process.argv.includes('--validate')) validate();
else build();
