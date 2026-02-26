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
function buildCookieUrl(domain, path) {
  const cleanDomain = domain.replace(/^\./, '');
  const cleanPath = path || '/';
  return `https://${cleanDomain}${cleanPath}`;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.type === 'INJECT_AND_OPEN') {
    const { cookies, targetUrl } = message;
    const results = { success: [], failed: [] };

    const setCookiesSequentially = async () => {
      // 1. Clear existing cookies for this domain first to avoid conflicts
      const urlObj = new URL(targetUrl);
      const existingCookies = await chrome.cookies.getAll({ domain: urlObj.hostname });
      for (const c of existingCookies) {
        const cUrl = `https://${c.domain.replace(/^\./, '')}${c.path}`;
        await chrome.cookies.remove({ url: cUrl, name: c.name });
      }

      // 2. Set new cookies
      for (const cookie of cookies) {
        const sameSite = fixSameSite(cookie.sameSite);
        const isSecure = (sameSite === 'no_restriction') ? true : (cookie.secure !== false);
        const domain = cookie.domain.startsWith('.') ? cookie.domain : '.' + cookie.domain;
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

        if (cookie.expirationDate && cookie.expirationDate > Date.now() / 1000) {
          cookieParams.expirationDate = cookie.expirationDate;
        }

        try {
          console.log('Setting cookie:', cookie.name, 'on', url);
          const result = await chrome.cookies.set(cookieParams);
          if (result) {
            results.success.push(cookie.name);
          } else {
            const err = chrome.runtime.lastError ? chrome.runtime.lastError.message : 'Unknown rejection';
            results.failed.push({ name: cookie.name, reason: err });
          }
        } catch (e) {
          results.failed.push({ name: cookie.name, reason: e.message });
        }
      }

      // 3. Verification step: Check if critical cookies were actually set
      const verifiedCookies = await chrome.cookies.getAll({ domain: urlObj.hostname });
      console.log('Verification: Cookies currently set for', urlObj.hostname, verifiedCookies.map(c => c.name));

      // 4. Open tab
      if (results.success.length > 0) {
        await chrome.tabs.create({ url: targetUrl });
      }

      return results;
    };

    setCookiesSequentially()
      .then(results => sendResponse({ success: true, results }))
      .catch(err => sendResponse({ success: false, error: err.message }));

    return true;
  }

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
    clearAll().then(cleared => sendResponse({ success: true, cleared }));
    return true;
  }
});
