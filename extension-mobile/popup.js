const MEMBERSHIP_URL = 'https://6cbfb053-e399-4cf0-a649-373f485ef582-00-386xnci2vytem.pike.replit.dev';
const SERVICE_URL = 'https://sharely-production-bc58.up.railway.app';
let accessToken = '';

const $ = id => document.getElementById(id);
function showMessage(text, kind = '') {
  $('message').textContent = text;
  $('message').className = `muted ${kind}`;
}
function send(type, payload = {}) {
  return new Promise(resolve => browserAPI.runtime.sendMessage({ type, ...payload }, resolve));
}
function openUrl(url) {
  if (api.hasApi('tabs.create')) return api.tabsCreate({ url });
  window.open(url, '_blank');
}

async function load() {
  $('apiState').textContent = api.hasApi('cookies.set') ? 'Cookie API found' : 'Cookie API unavailable';
  try {
    const sessionResponse = await fetch(`${MEMBERSHIP_URL}/api/membership/extension-session`, { credentials: 'include' });
    const session = await sessionResponse.json();
    if (!session.authenticated || !session.subscription?.active) {
      $('loading').classList.add('hidden'); $('login').style.display = 'block'; return;
    }
    accessToken = session.user.access_token || '';
    $('member').textContent = `Logged in as ${session.user.email}`;
    const response = await fetch(`${SERVICE_URL}/api/extension/config`, {
      headers: accessToken ? { 'X-API-Key': accessToken } : {},
    });
    if (!response.ok) throw new Error('Could not retrieve Sharely accounts.');
    const config = await response.json();
    const accounts = [];
    for (const service of config.services || []) {
      for (const account of service.accounts || []) accounts.push({ service, account });
      for (const sub of service.sub_services || []) {
        for (const account of sub.accounts || []) accounts.push({ service: sub, account });
      }
    }
    $('accounts').innerHTML = accounts.length ? accounts.map((item, index) =>
      `<button class="account" data-index="${index}"><span>${escapeHtml(item.service.name)} · ${escapeHtml(item.account.label)}</span><b>Open</b></button>`
    ).join('') : '<p class="muted">No accounts are currently available.</p>';
    $('accounts').querySelectorAll('.account').forEach(button => button.onclick = () => openAccount(accounts[button.dataset.index]));
    $('loading').classList.add('hidden'); $('content').classList.remove('hidden');
  } catch (error) {
    $('loading').classList.add('hidden'); $('content').classList.remove('hidden');
    $('member').textContent = error.message || 'Unable to connect to Sharely.';
    $('member').className = 'status error';
  }
}

async function openAccount({ service, account }) {
  showMessage('Retrieving authorized session…');
  const targetUrl = `https://${String(service.domain).replace(/^\./, '')}`;
  const result = await send('INJECT_AND_OPEN', { cookies: account.cookies, targetUrl });
  if (result?.success) showMessage(`Opened ${service.name}. ${result.results.success.length} cookies verified.`, 'ok');
  else showMessage(result?.error || 'Orion does not support this Sharely feature on iOS.', 'error');
}

$('loginButton').onclick = () => openUrl(`${MEMBERSHIP_URL}/membership/login`);
$('testButton').onclick = async () => {
  showMessage('Testing temporary cookie access…');
  const result = await send('CAPABILITY_TEST');
  showMessage(result.message, result.supported ? 'ok' : 'error');
  const diagnostic = $('diagnostic');
  diagnostic.classList.remove('hidden');
  const labels = {
    extensionLoaded: 'Extension loaded',
    cookiesApi: 'Cookies API',
    getAll: 'cookies.getAll',
    set: 'cookies.set',
    testCookieWrite: 'Test cookie write',
    testCookieRead: 'Test cookie read',
    openTarget: 'Open target page',
  };
  diagnostic.innerHTML = Object.entries(result.report || {}).map(([key, item]) =>
    `<div class="diagnostic-row"><b>${labels[key] || key}</b><span>${item.pass ? 'PASS' : 'FAIL'} — ${escapeHtml(item.detail)}</span></div>`
  ).join('');
};
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
}
load();