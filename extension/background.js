chrome.runtime.onInstalled.addListener(() => {
  console.log('Sharely Extension installed');
});

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SET_COOKIES') {
    const { cookies } = message;
    Promise.all(
      cookies.map(cookie => {
        const url = `http${cookie.secure ? 's' : ''}://${cookie.domain.replace(/^\./, '')}${cookie.path || '/'}`;
        return chrome.cookies.set({
          url,
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path || '/',
          secure: cookie.secure || false,
          httpOnly: cookie.httpOnly || false,
          sameSite: cookie.sameSite || 'lax',
          expirationDate: cookie.expirationDate || undefined,
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
          const url = `http${cookie.secure ? 's' : ''}://${cookie.domain.replace(/^\./, '')}${cookie.path}`;
          return chrome.cookies.remove({ url, name: cookie.name });
        })
      )
        .then(() => sendResponse({ success: true, cleared: cookies.length }))
        .catch(err => sendResponse({ success: false, error: err.message }));
    });
    return true;
  }
});
