/* background.js for Sharely Extension 1.1 */

chrome.runtime.onInstalled.addListener(() => {
  console.log('Sharely Extension installed');
  chrome.contextMenus.create({
    id: 'sharely-open',
    title: 'Open Sharely',
    contexts: ['action']
  });
});

function fixSameSite(value) {
  const v = (value || 'lax').toLowerCase();
  if (v === 'none' || v === 'no_restriction') return 'no_restriction';
  if (v === 'strict') return 'strict';
  return 'lax';
}

function buildCookieUrl(domain, path) {
  const cleanDomain = domain.replace(/^\./, '');
  return `https://${cleanDomain}${path || '/'}`;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.type === 'INJECT_AND_OPEN') {
    const { cookies, targetUrl } = message;
    const results = { success: [], failed: [] };

    const run = async () => {
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
          secure: isSecure,
          httpOnly: cookie.httpOnly || false,
          sameSite,
        };

        if (cookie.expirationDate && cookie.expirationDate > Date.now() / 1000) {
          params.expirationDate = cookie.expirationDate;
        }

        try {
          console.log('Setting cookie:', cookie.name, 'on', url, '| sameSite:', sameSite, '| httpOnly:', params.httpOnly);
          const result = await chrome.cookies.set(params);
          if (result) {
            results.success.push(cookie.name);
          } else {
            const err = chrome.runtime.lastError ? chrome.runtime.lastError.message : 'null result';
            results.failed.push({ name: cookie.name, reason: err });
          }
        } catch (e) {
          results.failed.push({ name: cookie.name, reason: e.message });
        }
      }

      // Verify
      const verified = await chrome.cookies.getAll({ domain: urlObj.hostname });
      console.log('Verified cookies for', urlObj.hostname, ':', verified.map(c => c.name));

      // Open tab
      if (results.success.length > 0) {
        await chrome.tabs.create({ url: targetUrl });
      }

      return results;
    };

    run()
      .then(results => sendResponse({ success: true, results }))
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
