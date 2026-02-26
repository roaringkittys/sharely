/* background.js for Sharely Extension 1.0 */

chrome.runtime.onInstalled.addListener(() => {
  console.log('Sharely Extension installed');
  chrome.contextMenus.create({
    id: 'sharely-open',
    title: 'Open Sharely',
    contexts: ['action']
  });
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// Fix SameSite values: Chrome cookies API uses specific strings
function fixSameSite(value) {
  const v = (value || 'lax').toLowerCase();
  if (v === 'none' || v === 'no_restriction') return 'no_restriction';
  if (v === 'strict') return 'strict';
  return 'lax'; // default safe value
}

// Build the correct URL for chrome.cookies.set()
// URL must NOT have leading dot but domain param must have it
function buildCookieUrl(domain, path) {
  const cleanDomain = domain.replace(/^\./, '');
  const cleanPath = path || '/';
  return `https://${cleanDomain}${cleanPath}`;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // ── INJECT_AND_OPEN ──────────────────────────────────────────────────
  // Injects all cookies for a service, then opens the site tab.
  // Handles all fixing (sameSite, secure, domain format) here.
  if (message.type === 'INJECT_AND_OPEN') {
    const { cookies, targetUrl } = message;

    const results = { success: [], failed: [] };

    const setCookiesSequentially = async () => {
      for (const cookie of cookies) {
        const sameSite = fixSameSite(cookie.sameSite);

        // SameSite=no_restriction requires secure=true
        const isSecure = (sameSite === 'no_restriction') ? true : (cookie.secure !== false);

        // Ensure domain starts with dot for domain-wide cookies
        const domain = cookie.domain.startsWith('.')
          ? cookie.domain
          : '.' + cookie.domain;

        const url = buildCookieUrl(domain, cookie.path);

        const cookieParams = {
          url,
          name: cookie.name,
          value: cookie.value,
          domain,
          path: cookie.path || '/',
          secure: isSecure,
          httpOnly: cookie.httpOnly || false,
          sameSite,
        };

        // Only set expiry if it's a real timestamp in the future
        if (cookie.expirationDate && cookie.expirationDate > Date.now() / 1000) {
          cookieParams.expirationDate = cookie.expirationDate;
        }

        try {
          const result = await chrome.cookies.set(cookieParams);
          if (result) {
            results.success.push(cookie.name);
          } else {
            results.failed.push({ name: cookie.name, reason: 'chrome returned null (check domain/secure)' });
          }
        } catch (e) {
          results.failed.push({ name: cookie.name, reason: e.message });
        }
      }

      // Open tab only after ALL cookies are written
      if (results.success.length > 0) {
        await chrome.tabs.create({ url: targetUrl });
      }

      return results;
    };

    setCookiesSequentially()
      .then(results => sendResponse({ success: true, results }))
      .catch(err => sendResponse({ success: false, error: err.message }));

    return true; // keep message channel open for async response
  }

  // ── CLEAR_ALL ─────────────────────────────────────────────────────────
  if (message.type === 'CLEAR_ALL') {
    const { domains } = message;

    const clearAll = async () => {
      let cleared = 0;
      for (const domain of domains) {
        const cookies = await chrome.cookies.getAll({ domain });
        for (const cookie of cookies) {
          const url = `https://${cookie.domain.replace(/^\./, '')}${cookie.path}`;
          try {
            await chrome.cookies.remove({ url, name: cookie.name });
            cleared++;
          } catch (e) { }
        }
      }
      return cleared;
    };

    clearAll()
      .then(cleared => sendResponse({ success: true, cleared }))
      .catch(err => sendResponse({ success: false, error: err.message }));

    return true;
  }
});
