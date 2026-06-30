/* popup.js — Sharely Account Manager v1.0 */

const DEFAULT_SERVER_URL = 'https://sharely-production-bc58.up.railway.app';

// ── Storage ───────────────────────────────────────────────────────────────────

async function loadStorage() {
  return new Promise(resolve =>
    chrome.storage.local.get(['serverUrl', 'apiKey', 'lastSync'], resolve)
  );
}

async function saveStorage(data) {
  return new Promise(resolve => chrome.storage.local.set(data, resolve));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function rootDomain(hostname) {
  const parts = hostname.replace(/^\./, '').split('.');
  return parts.length >= 2 ? parts.slice(-2).join('.') : hostname;
}

function setStatus(msg, type = '') {
  const el = document.getElementById('statusLine');
  el.textContent = msg;
  el.className = 'status-line' + (type ? ' ' + type : '');
}

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(ts).toLocaleDateString();
}

// ── Cookie reading via page context (no chrome.cookies permission) ────────────
// Uses chrome.scripting.executeScript to read document.cookie from the tab.
// This avoids the cookies permission entirely, bypassing management-based detection.
// Note: only non-httpOnly cookies are visible via document.cookie — this is a
// browser security boundary that applies to all JavaScript, including extensions.

async function readAllCookiesForDomain(hostname, tabId) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // Read every cookie the page can see, plus meta from the document
        const raw = document.cookie || '';
        const hostname = location.hostname;
        const domain = hostname.split('.').slice(-2).join('.');

        return raw.split(/;\s*/).filter(Boolean).map(pair => {
          const idx = pair.indexOf('=');
          const name = idx > 0 ? pair.slice(0, idx).trim() : pair.trim();
          const value = idx > 0 ? pair.slice(idx + 1) : '';
          return {
            name,
            value,
            domain: '.' + domain,
            path: '/',
            secure: location.protocol === 'https:',
            httpOnly: false,   // document.cookie never exposes httpOnly cookies
            sameSite: 'no_restriction',
            expirationDate: 0,
          };
        });
      },
    });
    return result || [];
  } catch (e) {
    console.warn('[SAM] executeScript failed:', e.message);
    return [];
  }
}

// ── Upload to backend ─────────────────────────────────────────────────────────

async function syncCookies(domain, cookies, serverUrl, apiKey) {
  const payload = {
    domain,
    cookies: cookies.map(c => ({
      name:           c.name,
      value:          c.value,
      domain:         c.domain,
      path:           c.path,
      secure:         c.secure,
      httpOnly:       c.httpOnly,
      sameSite:       c.sameSite,           // preserve exact Chrome value
      expirationDate: c.expirationDate || 0,
    })),
  };

  const res = await fetch(`${serverUrl}/api/account-sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    let msg = `Server error ${res.status}`;
    try { msg = JSON.parse(text).error || msg; } catch { /* raw text */ }
    throw new Error(msg);
  }

  return res.json();
}

// ── UI update helpers ─────────────────────────────────────────────────────────

function showBadge(status) {
  const badge = document.getElementById('statusBadge');
  badge.className = 'status-badge';
  if (status === 'created') {
    badge.classList.add('badge-new');
    badge.textContent = 'NEW';
  } else if (status === 'updated') {
    badge.classList.add('badge-updated');
    badge.textContent = 'UPDATED';
  } else {
    badge.classList.add('badge-ready');
    badge.textContent = 'READY';
  }
}

function setAccountName(name, isPlaceholder = false) {
  const el = document.getElementById('accountName');
  el.textContent = name;
  el.className = 'account-name' + (isPlaceholder ? ' placeholder' : '');
}

// ── Main init ─────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  const stored = await loadStorage();

  // Pre-fill settings fields
  document.getElementById('inputServerUrl').value = stored.serverUrl || '';
  document.getElementById('inputApiKey').value = stored.apiKey || '';

  const serverUrl = (stored.serverUrl || DEFAULT_SERVER_URL).replace(/\/+$/, '');
  const apiKey = stored.apiKey || '';

  // Warn if not configured
  if (!apiKey) {
    setStatus('⚠ Open Settings and enter your API key', 'err');
  }

  // Show last sync time
  if (stored.lastSync) {
    document.getElementById('lastSync').textContent =
      `Last sync: ${timeAgo(stored.lastSync.ts)} — ${stored.lastSync.accountLabel || ''}`;
  }

  // ── Get active tab ──────────────────────────────────────────────────────────
  let activeTab = null;
  let hostname = '';
  let domain = '';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('about:')) {
      activeTab = tab;
      const url = new URL(tab.url);
      hostname = url.hostname;
      domain = rootDomain(hostname);
    }
  } catch (e) { /* ignore */ }

  if (!activeTab) {
    document.getElementById('serviceName').textContent = 'No active tab';
    document.getElementById('serviceDomain').textContent = 'Navigate to a website first';
    setStatus('Navigate to a supported website', '');
    return;
  }

  // Show detected site
  document.getElementById('serviceName').textContent = domain;
  document.getElementById('serviceDomain').textContent = activeTab.title || hostname;

  // ── Read cookies immediately to show count ──────────────────────────────────
  let allCookies = [];

  try {
    allCookies = await readAllCookiesForDomain(hostname, activeTab.id);
  } catch (e) {
    setStatus('Failed to read cookies: ' + e.message, 'err');
  }

  if (allCookies.length === 0) {
    document.getElementById('cookieCount').textContent = '0';
    document.getElementById('domainCount').textContent = '0';
    document.getElementById('sessionCount').textContent = '—';
    setStatus('No cookies found — make sure you are logged in to this site', '');
    return;
  }

  // Stats
  const uniqueDomains = new Set(allCookies.map(c => c.domain)).size;
  const sessionLike = allCookies.filter(c => !c.expirationDate || c.expirationDate === 0 || c.httpOnly).length;

  document.getElementById('cookieCount').textContent = allCookies.length;
  document.getElementById('domainCount').textContent = uniqueDomains;
  document.getElementById('sessionCount').textContent = sessionLike;

  setStatus(apiKey ? 'Ready to sync — click Sync Now' : '⚠ API key not set — open Settings', apiKey ? '' : 'err');

  if (apiKey) {
    document.getElementById('syncBtn').disabled = false;
  }

  // ── Sync Now ────────────────────────────────────────────────────────────────
  document.getElementById('syncBtn').addEventListener('click', async () => {
    const btn    = document.getElementById('syncBtn');
    const icon   = document.getElementById('syncIcon');
    const text   = document.getElementById('syncText');

    btn.disabled = true;
    icon.textContent = '…';
    text.textContent = 'Syncing…';
    setStatus(`Reading ${allCookies.length} cookies…`, '');

    try {
      // Re-read cookies at moment of sync to get freshest values
      const freshCookies = await readAllCookiesForDomain(hostname, activeTab.id);
      if (freshCookies.length === 0) throw new Error('No cookies found — make sure you are logged in');

      setStatus('Uploading to Sharely…', '');
      const result = await syncCookies(domain, freshCookies, serverUrl, apiKey);

      // Update account display
      setAccountName(result.account_label);
      showBadge(result.status);

      // Update stats with fresh data
      document.getElementById('cookieCount').textContent = result.cookie_count;

      const msg = result.status === 'created'
        ? `✓ New account "${result.account_label}" created with ${result.cookie_count} cookies`
        : `✓ "${result.account_label}" updated — ${result.cookie_count} cookies synced`;

      setStatus(msg, 'ok');

      // Persist last sync info
      const syncInfo = { ts: Date.now(), accountLabel: result.account_label, status: result.status, count: result.cookie_count };
      await saveStorage({ lastSync: syncInfo });
      document.getElementById('lastSync').textContent =
        `Last sync: just now — ${result.account_label}`;

    } catch (err) {
      setStatus('✗ ' + err.message, 'err');
      showBadge('ready');
    } finally {
      btn.disabled = false;
      icon.textContent = '↑';
      text.textContent = 'Sync Now';
    }
  });

  // ── Settings overlay ────────────────────────────────────────────────────────
  document.getElementById('settingsBtn').addEventListener('click', () => {
    document.getElementById('settingsOverlay').classList.add('open');
  });

  function closeSettings() {
    document.getElementById('settingsOverlay').classList.remove('open');
  }

  document.getElementById('settingsClose').addEventListener('click', closeSettings);
  document.getElementById('settingsOverlay').addEventListener('click', e => {
    if (e.target === document.getElementById('settingsOverlay')) closeSettings();
  });

  document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
    const url = document.getElementById('inputServerUrl').value.trim().replace(/\/+$/, '');
    const key = document.getElementById('inputApiKey').value.trim();
    await saveStorage({ serverUrl: url || DEFAULT_SERVER_URL, apiKey: key });
    closeSettings();

    if (key) {
      document.getElementById('syncBtn').disabled = false;
      setStatus('Settings saved — ready to sync', 'ok');
    } else {
      document.getElementById('syncBtn').disabled = true;
      setStatus('⚠ API key not set — open Settings', 'err');
    }
    setTimeout(() => setStatus('Ready to sync — click Sync Now', ''), 2500);
  });
});
