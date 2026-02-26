let config = null;
let allServices = [];

async function loadConfig() {
  const stored = await chrome.storage.local.get(['serverUrl', 'apiKey', 'theme']);
  return stored;
}

async function saveConfig(serverUrl, apiKey) {
  await chrome.storage.local.set({ serverUrl, apiKey });
}

async function fetchServices() {
  const { serverUrl, apiKey } = await loadConfig();
  if (!serverUrl || !apiKey) {
    showSettingsPanel();
    return;
  }

  showLoading();

  try {
    const res = await fetch(`${serverUrl}/api/extension/config`, {
      headers: { 'X-API-Key': apiKey }
    });
    if (!res.ok) throw new Error('Failed to connect');
    const data = await res.json();
    allServices = data.services || [];
    renderServices(allServices);
    if (data.theme) applyTheme(data.theme);
  } catch (err) {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('emptyState').style.display = 'block';
    document.getElementById('emptyState').innerHTML = `<p>Could not connect to server</p><p style="font-size:11px;margin-top:8px">Check your settings</p>`;
  }
}

function showLoading() {
  document.getElementById('loading').style.display = 'flex';
  document.getElementById('servicesGrid').style.display = 'none';
  document.getElementById('emptyState').style.display = 'none';
}

function renderServices(services) {
  const grid = document.getElementById('servicesGrid');
  document.getElementById('loading').style.display = 'none';

  if (services.length === 0) {
    grid.style.display = 'none';
    document.getElementById('emptyState').style.display = 'block';
    return;
  }

  document.getElementById('emptyState').style.display = 'none';
  grid.style.display = 'grid';
  grid.innerHTML = services.map(s => `
    <div class="service-card" data-service-id="${s.id}" data-domain="${s.domain}" data-category="${s.category}">
      <div class="service-icon">${s.icon}</div>
      <div class="service-name">${s.name}<span class="service-status" title="${s.cookies.length} cookie(s)"></span></div>
      <div class="service-domain">${s.domain}</div>
    </div>
  `).join('');

  grid.querySelectorAll('.service-card').forEach(card => {
    card.addEventListener('click', () => {
      const serviceId = parseInt(card.dataset.serviceId);
      activateService(serviceId);
    });
  });
}

async function activateService(serviceId) {
  const service = allServices.find(s => s.id === serviceId);
  if (!service || !service.cookies.length) {
    showToast('No cookies configured for this service');
    return;
  }

  try {
    for (const cookie of service.cookies) {
      const url = `http${cookie.secure ? 's' : ''}://${cookie.domain.replace(/^\./, '')}${cookie.path}`;
      await chrome.cookies.set({
        url,
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path || '/',
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        sameSite: cookie.sameSite || 'lax',
        expirationDate: cookie.expirationDate || undefined,
      });
    }
    showToast(`${service.name} cookies set!`);
    chrome.tabs.create({ url: `https://${service.domain}` });
  } catch (err) {
    showToast('Error setting cookies');
    console.error(err);
  }
}

document.getElementById('searchInput').addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase();
  const filtered = allServices.filter(s =>
    s.name.toLowerCase().includes(q) || s.domain.toLowerCase().includes(q)
  );
  renderServices(filtered);
});

document.getElementById('categories').addEventListener('click', (e) => {
  if (!e.target.classList.contains('cat-btn')) return;
  document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
  e.target.classList.add('active');
  const cat = e.target.dataset.category;
  if (cat === 'all') {
    renderServices(allServices);
  } else {
    renderServices(allServices.filter(s => s.category === cat));
  }
});

document.getElementById('refreshBtn').addEventListener('click', fetchServices);

document.getElementById('settingsBtn').addEventListener('click', showSettingsPanel);
document.getElementById('closeSettings').addEventListener('click', () => {
  document.getElementById('settingsPanel').style.display = 'none';
});

async function showSettingsPanel() {
  const { serverUrl, apiKey, theme } = await loadConfig();
  document.getElementById('serverUrl').value = serverUrl || '';
  document.getElementById('apiKey').value = apiKey || '';
  document.querySelectorAll('.theme-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.theme === (theme || 'dark'));
  });
  document.getElementById('settingsPanel').style.display = 'block';
}

document.getElementById('saveSettings').addEventListener('click', async () => {
  const serverUrl = document.getElementById('serverUrl').value.replace(/\/+$/, '');
  const apiKey = document.getElementById('apiKey').value;
  if (!serverUrl || !apiKey) {
    showToast('Both fields are required');
    return;
  }
  await saveConfig(serverUrl, apiKey);
  document.getElementById('settingsPanel').style.display = 'none';
  fetchServices();
});

document.querySelectorAll('.theme-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const theme = btn.dataset.theme;
    await chrome.storage.local.set({ theme });
    applyTheme(theme);
  });
});

function applyTheme(theme) {
  document.body.classList.toggle('light', theme === 'light');
}

function showToast(msg) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

(async () => {
  const { theme } = await loadConfig();
  if (theme) applyTheme(theme);
  fetchServices();
})();
