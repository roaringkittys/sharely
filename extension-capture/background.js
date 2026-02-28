/* Sharely Capture — background.js */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_SITE_COOKIES') {
    const run = async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
        throw new Error('Please navigate to the website you want to capture first.');
      }

      const url = new URL(tab.url);
      const hostname = url.hostname;
      const parts = hostname.split('.');
      const rootDomain = parts.slice(-2).join('.');

      const [hostnameC, rootC, dotRootC] = await Promise.all([
        chrome.cookies.getAll({ domain: hostname }),
        chrome.cookies.getAll({ domain: rootDomain }),
        chrome.cookies.getAll({ domain: '.' + rootDomain }),
      ]);

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
});
