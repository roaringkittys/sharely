/* Sharely runtime adapted to Groupy's Orion-compatible MV3 service-worker slot. */

const apiCall = (method, namespace, details) => new Promise((resolve, reject) => {
  try {
    chrome.runtime.lastError;
    chrome[namespace][method](details, value => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(value);
    });
  } catch (error) {
    reject(error);
  }
});

function cookieUrl(cookie) {
  const domain = String(cookie.domain || '').replace(/^\./, '');
  return `https://${domain}${cookie.path || '/'}`;
}

function sameSiteValue(value) {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'none' || normalized === 'no_restriction') return 'no_restriction';
  if (normalized === 'strict') return 'strict';
  return 'lax';
}

function cookieDetails(cookie) {
  const details = {
    url: cookieUrl(cookie),
    name: cookie.name,
    value: cookie.value,
    path: cookie.path || '/',
    secure: cookie.secure !== false,
    httpOnly: cookie.httpOnly === true,
    sameSite: sameSiteValue(cookie.sameSite),
  };
  if (cookie.domain) details.domain = cookie.domain;
  if (Number.isFinite(cookie.expirationDate) && cookie.expirationDate > Date.now() / 1000) {
    details.expirationDate = cookie.expirationDate;
  }
  return details;
}

async function injectCookies(cookies, targetUrl) {
  const target = new URL(targetUrl);
  const results = { success: [], failed: [] };

  for (const cookie of cookies || []) {
    if (!cookie?.name || !cookie?.domain) {
      results.failed.push({ name: cookie?.name || '(unnamed)', reason: 'Invalid cookie definition' });
      continue;
    }
    try {
      const written = await apiCall('set', 'cookies', cookieDetails(cookie));
      if (written?.name === cookie.name) results.success.push(cookie.name);
      else results.failed.push({ name: cookie.name, reason: 'Browser rejected cookie' });
    } catch (error) {
      results.failed.push({ name: cookie.name, reason: error.message || 'Cookie write failed' });
    }
  }

  if (results.success.length) {
    const current = await apiCall('getAll', 'cookies', { domain: target.hostname });
    const names = new Set((current || []).map(cookie => cookie.name));
    results.success = results.success.filter(name => names.has(name));
  }
  if (!results.success.length) {
    const error = new Error('Orion could not write any Sharely cookies.');
    error.results = results;
    throw error;
  }
  await apiCall('create', 'tabs', { url: targetUrl });
  return results;
}

async function capabilityTest() {
  const report = {
    extensionLoaded: { pass: true, detail: 'Sharely service worker responded.' },
    cookiesApi: { pass: Boolean(chrome.cookies?.set && chrome.cookies?.getAll), detail: '' },
    getAll: { pass: false, detail: 'Not run.' },
    set: { pass: false, detail: 'Not run.' },
    testCookieWrite: { pass: false, detail: 'Not run.' },
    testCookieRead: { pass: false, detail: 'Not run.' },
    openTarget: { pass: false, detail: 'Not run.' },
  };
  if (!report.cookiesApi.pass) {
    report.cookiesApi.detail = 'Orion did not expose cookies.set or cookies.getAll.';
    return { supported: false, report, message: 'Orion does not support Sharely cookie access.' };
  }

  const domain = 'example.com';
  const name = 'sharely_orion_test';
  try {
    const before = await apiCall('getAll', 'cookies', { domain });
    report.getAll = { pass: Array.isArray(before), detail: `Returned ${before.length} cookies.` };
    const written = await apiCall('set', 'cookies', {
      url: `https://${domain}/`, name, value: 'test-only', domain, path: '/',
      secure: true, httpOnly: true, sameSite: 'lax',
    });
    report.set = { pass: Boolean(written), detail: written ? 'cookies.set returned a cookie.' : 'No cookie returned.' };
    report.testCookieWrite = { pass: written?.name === name, detail: written?.name === name ? 'Test write accepted.' : 'Test write rejected.' };
    const after = await apiCall('getAll', 'cookies', { domain });
    const found = (after || []).some(cookie => cookie.name === name);
    report.testCookieRead = { pass: found, detail: found ? 'Test cookie read back.' : 'Test cookie not returned.' };
    if (chrome.cookies.remove) await apiCall('remove', 'cookies', { url: `https://${domain}/`, name });
    await apiCall('create', 'tabs', { url: `https://${domain}/` });
    report.openTarget = { pass: true, detail: 'example.com opened.' };
  } catch (error) {
    for (const item of Object.values(report)) {
      if (!item.pass && item.detail === 'Not run.') item.detail = error.message || 'Capability test failed.';
    }
  }
  const supported = Object.values(report).every(item => item.pass);
  return { supported, report, message: supported ? 'Sharely cookie access passed.' : 'Orion rejected one or more cookie operations.' };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_MEMBERSHIP_SESSION_COOKIE') {
    const url = String(message.membershipUrl || '').replace(/\/+$/, '') + '/';
    chrome.cookies.get({ url, name: 'connect.sid' }, cookie => {
      const error = chrome.runtime.lastError;
      if (error) {
        sendResponse({ success: false, error: error.message });
        return;
      }
      sendResponse({ success: true, cookie: cookie?.value || '' });
    });
    return true;
  }
  if (message.type === 'CAPABILITY_TEST') {
    capabilityTest().then(sendResponse, error => sendResponse({ supported: false, message: error.message }));
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