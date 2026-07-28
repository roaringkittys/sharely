#!/usr/bin/env node
/*
 * Build and validate the Orion package without copying the extension directory
 * into the archive. Requires only Node.js and the system zip/unzip commands.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'extension-mobile');
const dist = path.join(root, 'dist');
const output = path.join(dist, 'sharely-orion.zip');
const required = ['manifest.json', 'browser-api.js', 'background.js', 'popup.html', 'popup.js'];
const forbidden = /(^|\/)(__MACOSX|\.git|node_modules)(\/|$)|(^|\/)\.DS_Store$/;

function fail(message) {
  console.error(`Orion build validation failed: ${message}`);
  process.exit(1);
}

function readManifest() {
  const manifestPath = path.join(source, 'manifest.json');
  if (!fs.existsSync(manifestPath)) fail('manifest.json is missing');
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    fail(`manifest.json is not valid JSON: ${error.message}`);
  }
  if (manifest.manifest_version !== 2) fail('manifest_version must be 2 for this Orion target');
  if (!manifest.background || !Array.isArray(manifest.background.scripts)) {
    fail('background.scripts is required');
  }
  if (manifest.background.scripts[0] !== 'browser-api.js' ||
      manifest.background.scripts[1] !== 'background.js') {
    fail('browser-api.js must load before background.js');
  }
  return manifest;
}

function sourceFiles() {
  for (const file of required) {
    if (!fs.existsSync(path.join(source, file))) fail(`required runtime file is missing: ${file}`);
  }
  const entries = fs.readdirSync(source, { withFileTypes: true });
  for (const entry of entries) {
    if (forbidden.test(entry.name)) fail(`forbidden source entry: ${entry.name}`);
  }
}

function archiveEntries() {
  let listing;
  try {
    listing = execFileSync('unzip', ['-Z1', output], { encoding: 'utf8' })
      .split(/\r?\n/).filter(Boolean);
  } catch (error) {
    fail(`could not inspect ZIP: ${error.message}`);
  }
  if (!listing.includes('manifest.json')) fail('manifest.json is not at ZIP root');
  if (listing.some(name => name.includes('/') || forbidden.test(name))) {
    fail('ZIP contains a wrapper directory or forbidden metadata/dependency');
  }
  for (const file of required) {
    if (!listing.includes(file)) fail(`ZIP is missing ${file}`);
  }
  return listing;
}

function validate() {
  readManifest();
  sourceFiles();
  if (!fs.existsSync(output)) fail(`ZIP does not exist: ${path.relative(root, output)}`);
  const listing = archiveEntries();
  console.log(`Validated ${path.relative(root, output)} (${listing.length} root files)`);
}

function build() {
  readManifest();
  sourceFiles();
  fs.mkdirSync(dist, { recursive: true });
  if (fs.existsSync(output)) fs.unlinkSync(output);
  try {
    execFileSync('zip', ['-q', '-X', output, ...required], { cwd: source, stdio: 'inherit' });
  } catch (error) {
    fail(`zip command failed: ${error.message}`);
  }
  archiveEntries();
  console.log(`Built ${path.relative(root, output)}`);
}

if (process.argv.includes('--validate')) validate();
else build();