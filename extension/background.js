/* background.js for Sharely Extension 1.1 */

chrome.runtime.onInstalled.addListener(() => {
  console.log('Sharely Extension installed');
  chrome.contextMenus.create({
    id: 'sharely-open',
    title: 'Open Sharely',
    contexts: ['all']
  });
});

function fixSameSite(value) {
  const v = (value || 'lax').toLowerCase();
  if (v === 'none' || v === 'no_restriction') return 'no_restriction';
  if (v === 'strict') return 'strict';
  return 'lax';
}

// Orion/WebKit may reject 'no_restriction' + secure:true combo.
// Try with no_restriction first, fall back to 'unspecified' (omit sameSite)
// if the browser doesn't support the Chrome-only value.
async function setCookieSafely(params, results) {
  try {
    const result = await chrome.cookies.set(params);
    if (result) {
      results.success.push(params.name);
      return;
    }
  } catch (e) {
    // fall through to retry
  }

  // Retry without sameSite for WebKit/Orion compatibility
  const retryParams = { ...params };
  delete retryParams.sameSite;
  try {
    const result2 = await chrome.cookies.set(retryParams);
    if (result2) {
      results.success.push(params.name);
      return;
    }
  } catch (e2) {
    const err = chrome.runtime.lastError ? chrome.runtime.lastError.message : (e2.message || 'null result');
    results.failed.push({ name: params.name, reason: err });
  }
}

function buildCookieUrl(domain, path) {
  const cleanDomain = domain.replace(/^\./, '');
  return `https://${cleanDomain}${path || '/'}`;
}

// ── Session guard ─────────────────────────────────────────────────────────
// Reads the cached member session from chrome.storage.session (written by
// the popup's checkSession()) to verify access before injecting cookies.
// Falls back gracefully: if no session cache exists, allows injection
// (popup already verified auth). Only blocks when cache explicitly shows
// the session is not authenticated and no admin API key is configured.
async function isMemberSessionValid() {
  try {
    const stored = await chrome.storage.local.get(['apiKey']);
    const adminKey = (stored.apiKey || '').trim();

    if (!chrome.storage.session) return true; // session API unavailable — allow
    const cached = await new Promise(r => chrome.storage.session.get('memberSession', r));
    if (!cached.memberSession) return true; // no cache yet — allow (popup will enforce)

    const { authenticated, subscription } = cached.memberSession;
    const hasActiveSub = authenticated && subscription && subscription.active;

    // Only block if we know session is invalid AND there is no admin key fallback
    return hasActiveSub || !!adminKey;
  } catch (e) {
    return true; // On any error allow injection — do not silently break cookie inject
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.type === 'INJECT_AND_OPEN') {
    const { cookies, targetUrl } = message;
    const results = { success: [], failed: [] };

    const run = async () => {
      // Verify session before injecting
      const allowed = await isMemberSessionValid();
      if (!allowed) {
        throw new Error('Session expired. Please log in at the Sharely dashboard.');
      }

      const urlObj = new URL(targetUrl);

      // Clear existing cookies for this domain
      const existing = await chrome.cookies.getAll({ domain: urlObj.hostname });
      for (const c of existing) {
        const cUrl = `https://${c.domain.replace(/^\./, '')}${c.path}`;
        await chrome.cookies.remove({ url: cUrl, name: c.name }).catch(() => {});
      }

      // Set new cookies
      for (const cookie of cookies) {
        const sameSite = fixSameSite(cookie.sameSite);
        const isSecure = (sameSite === 'no_restriction') ? true : (cookie.secure !== false);
        const domain = cookie.domain.startsWith('.') ? cookie.domain : '.' + cookie.domain;
        const url = buildCookieUrl(domain, cookie.path);

        const params = {
          url,
          name: cookie.name,
          value: cookie.value,
          domain,
          path: cookie.path || '/',
          secure: true, // Always force secure for cross-site premium services
          httpOnly: cookie.httpOnly || false,
          sameSite: sameSite,
        };

        if (cookie.expirationDate && cookie.expirationDate > Date.now() / 1000) {
          params.expirationDate = cookie.expirationDate;
        }

        console.log('Setting cookie:', cookie.name, 'on', url, '| sameSite:', sameSite, '| httpOnly:', params.httpOnly);
        await setCookieSafely(params, results);
      }

      // Verify
      const verified = await chrome.cookies.getAll({ domain: urlObj.hostname });
      console.log('Verified cookies for', urlObj.hostname, ':', verified.map(c => c.name));

      // Open tab (Orion-safe fallback to window.open if tabs API fails)
      if (results.success.length > 0) {
        try {
          await chrome.tabs.create({ url: targetUrl });
        } catch (tabErr) {
          console.warn('tabs.create failed, trying window.open fallback:', tabErr);
          try {
            window.open(targetUrl, '_blank');
          } catch (winErr) {
            console.error('Both tab creation methods failed:', winErr);
          }
        }
      }

      return results;
    };

    run()
      .then(results => sendResponse({ success: true, results }))
      .catch(err => sendResponse({ success: false, error: err.message }));

    return true;
  }

  // ── GET_SITE_COOKIES ─────────────────────────────────────────────────
  // Reads all cookies from the currently active tab for One-Click Capture
  if (message.type === 'GET_SITE_COOKIES') {
    const run = async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.url || tab.url.startsWith('chrome://')) {
        throw new Error('Please navigate to the website you want to capture first.');
      }

      const url = new URL(tab.url);
      const hostname = url.hostname; // e.g. "www.netflix.com"
      const parts = hostname.split('.');
      const rootDomain = parts.slice(-2).join('.'); // e.g. "netflix.com"

      // Get cookies for both the full hostname and root domain
      const [hostnameC, rootC, dotRootC] = await Promise.all([
        chrome.cookies.getAll({ domain: hostname }),
        chrome.cookies.getAll({ domain: rootDomain }),
        chrome.cookies.getAll({ domain: '.' + rootDomain }),
      ]);

      // Merge and deduplicate by name+domain
      const seen = new Set();
      const all = [...hostnameC, ...rootC, ...dotRootC].filter(c => {
        const key = c.name + '|' + c.domain;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      return { hostname, rootDomain, tabTitle: tab.title || rootDomain, cookies: all };
    };

    run()
      .then(result => sendResponse({ success: true, ...result }))
      .catch(err => sendResponse({ success: false, error: err.message }));

    return true;
  }

  if (message.type === 'CLEAR_ALL') {
    const { domains } = message;
    const clear = async () => {
      let cleared = 0;
      for (const domain of domains) {
        const cookies = await chrome.cookies.getAll({ domain });
        for (const c of cookies) {
          const url = `https://${c.domain.replace(/^\./, '')}${c.path}`;
          await chrome.cookies.remove({ url, name: c.name }).catch(() => {});
          cleared++;
        }
      }
      return cleared;
    };
    clear().then(cleared => sendResponse({ success: true, cleared }));
    return true;
  }
});
