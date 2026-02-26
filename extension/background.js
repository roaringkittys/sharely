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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SET_COOKIES') {
    const { cookies } = message;
    Promise.all(
      cookies.map(cookie => {
        const domain = cookie.domain.startsWith('.') ? cookie.domain : '.' + cookie.domain;
        const url = `https://${domain.replace(/^\./, '')}${cookie.path || '/'}`;
        return chrome.cookies.set({
          url,
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path || '/',
          secure: cookie.secure !== false,
          httpOnly: cookie.httpOnly || false,
          sameSite: (cookie.sameSite || 'lax').toLowerCase(),
          expirationDate: cookie.expirationDate && cookie.expirationDate > 0 ? cookie.expirationDate : undefined,
        });
      })
    )
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'CLEAR_COOKIES') {
    const { domain } = message;
    chrome.cookies.getAll({ domain }, (cookies) => {
      Promise.all(
        cookies.map(cookie => {
          const url = `https://${cookie.domain.replace(/^\./, '')}${cookie.path}`;
          return chrome.cookies.remove({ url, name: cookie.name });
        })
      )
        .then(() => sendResponse({ success: true, cleared: cookies.length }))
        .catch(err => sendResponse({ success: false, error: err.message }));
    });
    return true;
  }
});
