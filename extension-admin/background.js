/* background.js — Sharely Manager (Admin) */

const DEFAULT_SERVER_URL = 'https://sharely-production-bc58.up.railway.app';
const ALARM_NAME = 'sharely-heartbeat';
const HEARTBEAT_MINUTES = 30;
const DEBOUNCE_MS = 1500;

// ── Storage helpers ───────────────────────────────────────────────────────────

async function loadStorage() {
  return new Promise(resolve =>
    chrome.storage.local.get(
      ['serverUrl', 'apiKey', 'trackedDomains', 'cookieHashes', 'syncLog'],
      resolve
    )
  );
}

async function saveStorage(data) {
  return new Promise(resolve => chrome.storage.local.set(data, resolve));
}

// ── Cookie helpers ────────────────────────────────────────────────────────────

function rootDomain(hostname) {
  const parts = hostname.replace(/^\./, '').split('.');
  return parts.length >= 2 ? parts.slice(-2).join('.') : hostname;
}

async function getAllCookiesForDomain(domain) {
  const clean = domain.replace(/^\./, '');
  const [a, b, c] = await Promise.all([
    chrome.cookies.getAll({ domain: clean }),
    chrome.cookies.getAll({ domain: '.' + clean }),
    chrome.cookies.getAll({ domain: 'www.' + clean }),
  ]);

  const seen = new Set();
  return [...a, ...b, ...c].filter(ck => {
    const key = ck.name + '|' + ck.domain;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Simple hash: sort cookies by name, stringify, djb2
function hashCookies(cookies) {
  const str = cookies
    .slice()
    .sort((a, b) => (a.name + a.domain).localeCompare(b.name + b.domain))
    .map(c => `${c.name}=${c.value}@${c.domain}`)
    .join('|');
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
    h >>>= 0;
  }
  return h.toString(16);
}

// ── Upload ────────────────────────────────────────────────────────────────────

async function uploadCookies(domain, cookies, serverUrl, apiKey, label) {
  const cleanDomain = domain.replace(/^www\./, '').replace(/^\./, '');
  const payload = {
    domain: cleanDomain,
    label: label || `Auto-sync ${new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
    cookies: cookies.map(c => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path || '/',
      secure: c.secure,
      httpOnly: c.httpOnly,
      expirationDate: c.expirationDate || 0,
      sameSite: c.sameSite || 'no_restriction',
    })),
  };

  const res = await fetch(`${serverUrl}/api/capture`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Server ${res.status}: ${text}`);
  }
  return res.json();
}

// ── Sync a single domain ──────────────────────────────────────────────────────

async function syncDomain(domain, { serverUrl, apiKey, cookieHashes, syncLog, forced = false } = {}) {
  const stored = await loadStorage();
  const url = (serverUrl || stored.serverUrl || DEFAULT_SERVER_URL).replace(/\/+$/, '');
  const key = apiKey || stored.apiKey || '';
  const hashes = cookieHashes || stored.cookieHashes || {};
  const log = syncLog || stored.syncLog || [];

  if (!key) {
    console.warn('[Sharely Manager] No API key configured — skipping sync for', domain);
    return { skipped: true, reason: 'no_api_key' };
  }

  const cookies = await getAllCookiesForDomain(domain);
  if (cookies.length === 0) {
    console.log('[Sharely Manager] No cookies found for', domain);
    return { skipped: true, reason: 'no_cookies' };
  }

  const hash = hashCookies(cookies);
  if (!forced && hashes[domain] === hash) {
    console.log('[Sharely Manager] Cookies unchanged for', domain);
    return { skipped: true, reason: 'unchanged' };
  }

  try {
    const result = await uploadCookies(domain, cookies, url, key);
    hashes[domain] = hash;

    const entry = {
      domain,
      count: result.count,
      label: result.label,
      ts: Date.now(),
      ok: true,
    };
    const newLog = [entry, ...log].slice(0, 50);
    await saveStorage({ cookieHashes: hashes, syncLog: newLog });

    console.log('[Sharely Manager] Synced', cookies.length, 'cookies for', domain);
    return { success: true, count: result.count, label: result.label };
  } catch (err) {
    const entry = { domain, error: err.message, ts: Date.now(), ok: false };
    const newLog = [entry, ...log].slice(0, 50);
    await saveStorage({ syncLog: newLog });
    console.error('[Sharely Manager] Upload failed for', domain, err.message);
    return { success: false, error: err.message };
  }
}

// ── Heartbeat: sync all tracked domains ───────────────────────────────────────

async function heartbeat(forced = false) {
  const stored = await loadStorage();
  const domains = stored.trackedDomains || [];
  console.log('[Sharely Manager] Heartbeat — syncing', domains.length, 'domains');

  for (const domain of domains) {
    await syncDomain(domain, { forced });
  }
}

// ── Alarm setup ───────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  console.log('[Sharely Manager] Installed — setting up heartbeat alarm');
  chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: HEARTBEAT_MINUTES,
    periodInMinutes: HEARTBEAT_MINUTES,
  });
  const stored = await loadStorage();
  if (!stored.serverUrl && DEFAULT_SERVER_URL) {
    await saveStorage({ serverUrl: DEFAULT_SERVER_URL });
  }
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM_NAME) {
    heartbeat(false);
  }
});

// ── Cookie change listener ────────────────────────────────────────────────────

const debounceTimers = {};

chrome.cookies.onChanged.addListener(({ cookie, removed }) => {
  const domain = rootDomain(cookie.domain);

  chrome.storage.local.get(['trackedDomains'], ({ trackedDomains }) => {
    const domains = trackedDomains || [];
    if (!domains.includes(domain)) return;

    // Debounce: wait for cookie changes to settle before uploading
    clearTimeout(debounceTimers[domain]);
    debounceTimers[domain] = setTimeout(() => {
      syncDomain(domain);
    }, DEBOUNCE_MS);
  });
});

// ── Message handler (from popup) ──────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // Sync a specific domain now
  if (message.type === 'SYNC_DOMAIN') {
    syncDomain(message.domain, { forced: true })
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // Sync all tracked domains (heartbeat on demand)
  if (message.type === 'SYNC_ALL') {
    heartbeat(true)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // Get cookies for the active tab (popup preview)
  if (message.type === 'GET_ACTIVE_COOKIES') {
    const run = async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.url || tab.url.startsWith('chrome://')) {
        return { domain: null, count: 0 };
      }
      const url = new URL(tab.url);
      const domain = rootDomain(url.hostname);
      const cookies = await getAllCookiesForDomain(domain);
      return { domain, hostname: url.hostname, count: cookies.length, tabTitle: tab.title || domain };
    };
    run().then(r => sendResponse(r)).catch(err => sendResponse({ error: err.message }));
    return true;
  }
});
