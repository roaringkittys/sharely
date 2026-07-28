/* Sharely Orion mobile background page. Cookie values are never logged. */
/* browser-api.js is loaded first via manifest background.scripts — no importScripts needed. */

function cookieUrl(cookie) {
  const domain = String(cookie.domain || '').replace(/^\./, '');
  const path = cookie.path || '/';
  return `https://${domain}${path}`;
}

function sameSiteValue(value) {
  const v = String(value || '').toLowerCase();
  if (v === 'none' || v === 'no_restriction') return 'no_restriction';
  if (v === 'strict') return 'strict';
  return 'lax';
}

function capabilityError() {
  return new Error('Orion does not support this Sharely feature on iOS.');
}

async function requireCookieApi() {
  if (!api.available || !api.hasApi('cookies.set') || !api.hasApi('cookies.getAll')) {
    throw capabilityError();
  }
}

function safeCookieParams(cookie) {
  const params = {
    url: cookieUrl(cookie),
    name: cookie.name,
    value: cookie.value,
    path: cookie.path || '/',
    secure: cookie.secure !== false,
    httpOnly: cookie.httpOnly === true,
    sameSite: sameSiteValue(cookie.sameSite),
  };
  // Omitting domain preserves host-only behavior when the source cookie has
  // no domain. A leading dot is retained for domain cookies.
  if (cookie.domain) params.domain = cookie.domain;
  if (Number.isFinite(cookie.expirationDate) && cookie.expirationDate > Date.now() / 1000) {
    params.expirationDate = cookie.expirationDate;
  }
  return params;
}

async function injectCookies(cookies, targetUrl) {
  await requireCookieApi();
  const target = new URL(targetUrl);
  const results = { success: [], failed: [] };

  for (const cookie of cookies || []) {
    if (!cookie || !cookie.name || !cookie.domain) {
      results.failed.push({ name: cookie?.name || '(unnamed)', reason: 'Invalid cookie definition' });
      continue;
    }
    try {
      const result = await api.cookiesSet(safeCookieParams(cookie));
      if (result && result.name === cookie.name) {
        results.success.push(cookie.name);
      } else {
        results.failed.push({ name: cookie.name, reason: 'Browser rejected cookie' });
      }
    } catch (error) {
      results.failed.push({
        name: cookie.name,
        reason: error?.message || 'Cookie permission denied',
      });
    }
  }

  // Read-back is required; a successful promise alone is not enough.
  if (results.success.length) {
    const verified = await api.cookiesGetAll({ domain: target.hostname });
    const names = new Set((verified || []).map(cookie => cookie.name));
    results.success = results.success.filter(name => names.has(name));
  }

  if (!results.success.length) {
    throw Object.assign(capabilityError(), { results });
  }
  if (api.hasApi('tabs.create')) await api.tabsCreate({ url: targetUrl });
  return results;
}

async function runCapabilityTest() {
  if (!api.available || !api.hasApi('cookies.set') || !api.hasApi('cookies.getAll')) {
    return { supported: false, message: 'Orion does not support this Sharely feature on iOS.' };
  }
  const domain = 'example.com';
  const name = 'sharely_orion_test';
  const url = `https://${domain}/`;
  try {
    const setResult = await api.cookiesSet({
      url,
      name,
      value: 'test-only',
      domain,
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'lax',
    });
    const cookies = await api.cookiesGetAll({ domain });
    const found = (cookies || []).some(cookie => cookie.name === name);
    if (api.hasApi('cookies.remove')) await api.cookiesRemove({ url, name });
    return {
      supported: Boolean(setResult && found),
      message: setResult && found
        ? 'Cookie API test passed.'
        : 'Orion rejected the test cookie or did not return it on read-back.',
    };
  } catch (error) {
    return { supported: false, message: error?.message || 'Cookie permission denied.' };
  }
}

browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CAPABILITY_TEST') {
    runCapabilityTest().then(sendResponse, error => sendResponse({
      supported: false,
      message: error?.message || 'Capability test failed.',
    }));
    return true;
  }
  if (message.type === 'INJECT_AND_OPEN') {
    injectCookies(message.cookies, message.targetUrl).then(
      results => sendResponse({ success: true, results }),
      error => sendResponse({ success: false, error: error.message, results: error.results }),
    );
    return true;
  }
});