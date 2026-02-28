/* Sharely Capture — popup.js */

let serverUrl = '';
let apiKey = '';
let capturedCookies = [];
let capturedDomain = '';

function show(viewId) {
  ['viewNoSettings','viewScanning','viewReady','viewError','viewSuccess']
    .forEach(id => document.getElementById(id).style.display = 'none');
  document.getElementById(viewId).style.display = 'block';
}

function setStatus(msg, color) {
  const el = document.getElementById('settingsStatus');
  el.textContent = msg;
  el.style.color = color || '#aaa';
}

async function loadSettings() {
  return new Promise(resolve => {
    chrome.storage.local.get(['serverUrl', 'apiKey'], resolve);
  });
}

async function saveSettings(url, key) {
  return new Promise(resolve => {
    chrome.storage.local.set({ serverUrl: url, apiKey: key }, resolve);
  });
}

document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
  const url = document.getElementById('serverUrlInput').value.trim().replace(/\/+$/, '');
  const key = document.getElementById('apiKeyInput').value.trim();
  if (!url || !key) { setStatus('Both fields are required.', '#e74c3c'); return; }
  setStatus('Saving...', '#aaa');
  await saveSettings(url, key);
  serverUrl = url;
  apiKey = key;
  setStatus('Saved! Scanning...', '#55efc4');
  setTimeout(() => { setStatus(''); startCapture(); }, 600);
});

document.getElementById('captureBtn').addEventListener('click', async () => {
  if (!capturedCookies.length) return;

  const label = document.getElementById('labelInput').value.trim() || undefined;
  const btn = document.getElementById('captureBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Sending...';

  try {
    const res = await fetch(`${serverUrl}/api/capture`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify({
        domain: capturedDomain,
        cookies: capturedCookies.map(c => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path,
          secure: c.secure,
          httpOnly: c.httpOnly,
          expirationDate: c.expirationDate,
        })),
        label,
      }),
    });

    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Unknown error');

    document.getElementById('successTitle').textContent = `${data.count} cookies captured!`;
    document.getElementById('successSub').textContent =
      `Saved to "${data.service_name}" as "${data.label}" in your Sharely Dashboard.`;
    show('viewSuccess');

  } catch (err) {
    document.getElementById('errorMsg').textContent = 'Failed to send: ' + err.message;
    show('viewError');
  }
});

async function startCapture() {
  show('viewScanning');
  chrome.runtime.sendMessage({ type: 'GET_SITE_COOKIES' }, (response) => {
    if (chrome.runtime.lastError || !response || !response.success) {
      const err = (response && response.error) || 'Could not read tab cookies.';
      document.getElementById('errorMsg').textContent = err;
      show('viewError');
      return;
    }

    const { hostname, rootDomain, tabTitle, cookies } = response;
    capturedCookies = cookies;
    capturedDomain = rootDomain;

    if (cookies.length === 0) {
      document.getElementById('errorMsg').textContent =
        `No cookies found on ${hostname}. Make sure you are logged in to this site.`;
      show('viewError');
      return;
    }

    document.getElementById('siteDomain').textContent = hostname;
    document.getElementById('siteTab').textContent = tabTitle;
    document.getElementById('siteFavicon').src = `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`;
    document.getElementById('cookieCount').textContent = cookies.length;
    document.getElementById('labelInput').value = '';
    show('viewReady');
  });
}

// Init
(async () => {
  const stored = await loadSettings();
  serverUrl = (stored.serverUrl || '').replace(/\/+$/, '');
  apiKey = stored.apiKey || '';

  document.getElementById('serverUrlInput').value = serverUrl;
  document.getElementById('apiKeyInput').value = apiKey;

  if (!serverUrl || !apiKey) {
    show('viewNoSettings');
  } else {
    startCapture();
  }
})();
