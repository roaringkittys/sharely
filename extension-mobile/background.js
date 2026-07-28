/* Sharely Orion mobile background (MV3 service worker). Cookie values are never logged. */
importScripts('browser-api.js');

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
  const report = {
    extensionLoaded: { pass: true, detail: 'Background page responded.' },
    cookiesApi: { pass: api.hasApi('cookies.set') && api.hasApi('cookies.getAll'), detail: '' },
    getAll: { pass: false, detail: 'Not run.' },
    set: { pass: false, detail: 'Not run.' },
    testCookieWrite: { pass: false, detail: 'Not run.' },
    testCookieRead: { pass: false, detail: 'Not run.' },
    openTarget: { pass: false, detail: 'Not run.' },
  };
  if (!report.cookiesApi.pass) {
    report.cookiesApi.detail = 'cookies.set or cookies.getAll is unavailable.';
    return { supported: false, report, message: 'Orion does not support this Sharely feature on iOS.' };
  }
  const domain = 'example.com';
  const name = 'sharely_orion_test';
  const url = `https://${domain}/`;
  try {
    const before = await api.cookiesGetAll({ domain });
    report.getAll = { pass: Array.isArray(before), detail: `Returned ${before.length} cookies.` };
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
    report.set = { pass: Boolean(setResult), detail: setResult ? 'cookies.set returned a cookie.' : 'cookies.set returned no cookie.' };
    report.testCookieWrite = { pass: Boolean(setResult && setResult.name === name), detail: setResult ? 'Test cookie write accepted.' : 'Test cookie write rejected.' };
    const cookies = await api.cookiesGetAll({ domain });
    const found = (cookies || []).some(cookie => cookie.name === name);
    report.testCookieRead = { pass: found, detail: found ? 'Test cookie was read back.' : 'Test cookie was not returned.' };
    if (api.hasApi('cookies.remove')) await api.cookiesRemove({ url, name });
    if (api.hasApi('tabs.create')) {
      await api.tabsCreate({ url });
      report.openTarget = { pass: true, detail: 'example.com opened.' };
    } else {
      report.openTarget = { pass: false, detail: 'tabs.create is unavailable.' };
    }
    const passed = Object.values(report).every(item => item.pass);
    return {
      supported: passed,
      report,
      message: passed ? 'Cookie API test passed.' : 'Orion rejected one or more cookie operations.',
    };
  } catch (error) {
    const reason = error?.message || 'Cookie permission denied.';
    for (const key of Object.keys(report)) {
      if (!report[key].pass && report[key].detail === 'Not run.') report[key].detail = reason;
    }
    return { supported: false, report, message: reason };
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