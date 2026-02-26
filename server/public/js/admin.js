const API = {
  async get(url) { 
    const r = await fetch(url); 
    if (r.status === 401) { window.location.href = '/login'; return; } 
    return r.json(); 
  },
  async post(url, data) { 
    const r = await fetch(url, { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify(data) 
    }); 
    if (r.status === 401) { window.location.href = '/login'; return; } 
    return r.json(); 
  },
  async put(url, data) { 
    const r = await fetch(url, { 
      method: 'PUT', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify(data) 
    }); 
    if (r.status === 401) { window.location.href = '/login'; return; }
    return r.json(); 
  },
  async del(url) { 
    const r = await fetch(url, { method: 'DELETE' }); 
    if (r.status === 401) { window.location.href = '/login'; return; }
    return r.json(); 
  }
};

let servicesCache = [];

function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast ${type} show`;
  setTimeout(() => t.className = 'toast', 3000);
}

function closeModal(id) {
  document.getElementById(id).classList.remove('active');
}

function openModal(id) {
  document.getElementById(id).classList.add('active');
}

document.querySelectorAll('.sidebar-nav a').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const page = link.dataset.page;
    document.querySelectorAll('.sidebar-nav a').forEach(a => a.classList.remove('active'));
    link.classList.add('active');
    document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
    document.getElementById(`page-${page}`).style.display = 'block';
    loadPage(page);
    history.pushState(null, '', `#${page}`);
  });
});

async function loadPage(page) {
  switch (page) {
    case 'dashboard': await loadDashboard(); break;
    case 'services': await loadServices(); break;
    case 'cookies': await loadCookies(); break;
    case 'settings': await loadSettings(); break;
  }
}

async function loadDashboard() {
  const stats = await API.get('/api/stats');
  if (!stats) return;
  document.getElementById('statsGrid').innerHTML = `
    <div class="stat-card"><div class="stat-label">Total Services</div><div class="stat-value">${stats.totalServices}</div></div>
    <div class="stat-card"><div class="stat-label">Active Services</div><div class="stat-value">${stats.activeServices}</div></div>
    <div class="stat-card"><div class="stat-label">Total Cookies</div><div class="stat-value">${stats.totalCookies}</div></div>
    <div class="stat-card"><div class="stat-label">Active Cookies</div><div class="stat-value">${stats.activeCookies}</div></div>
  `;
  const cookies = await API.get('/api/cookies');
  if (!cookies) return;
  if (cookies.length === 0) {
    document.getElementById('recentCookiesTable').innerHTML = '<div class="empty-state"><p>No cookies added yet. Go to Cookies page to add some.</p></div>';
    return;
  }
  const recent = cookies.slice(0, 5);
  document.getElementById('recentCookiesTable').innerHTML = `<table><thead><tr><th>Service</th><th>Label</th><th>Cookie Name</th><th>Domain</th><th>Status</th></tr></thead><tbody>${recent.map(c => `<tr><td>${c.service_name}</td><td>${c.label}</td><td><code>${c.cookie_name}</code></td><td>${c.cookie_domain}</td><td><span class="badge ${c.enabled ? 'badge-success' : 'badge-danger'}">${c.enabled ? 'Active' : 'Disabled'}</span></td></tr>`).join('')}</tbody></table>`;
}

async function loadServices() {
  const services = await API.get('/api/services');
  if (!services) return;
  servicesCache = services;
  if (services.length === 0) {
    document.getElementById('servicesTable').innerHTML = '<div class="empty-state"><p>No services yet. Click "Add Service" to get started.</p></div>';
    return;
  }
  document.getElementById('servicesTable').innerHTML = `<table><thead><tr><th>Icon</th><th>Name</th><th>Domain</th><th>Category</th><th>Status</th><th>Actions</th></tr></thead><tbody>${services.map(s => `<tr>
    <td style="font-size:24px">${s.icon}</td>
    <td><strong>${s.name}</strong></td>
    <td><code>${s.domain}</code></td>
    <td><span class="badge badge-info">${s.category}</span></td>
    <td><span class="badge ${s.enabled ? 'badge-success' : 'badge-danger'}">${s.enabled ? 'Active' : 'Disabled'}</span></td>
    <td class="actions-cell">
      <button class="btn btn-outline btn-sm" onclick="editService(${s.id})">Edit</button>
      <button class="btn btn-danger btn-sm" onclick="deleteService(${s.id}, '${s.name}')">Delete</button>
    </td>
  </tr>`).join('')}</tbody></table>`;
}

async function loadCookies() {
  const services = await API.get('/api/services');
  if (!services) return;
  servicesCache = services;
  const filterEl = document.getElementById('cookieServiceFilter');
  const currentVal = filterEl.value;
  filterEl.innerHTML = '<option value="">All Services</option>' + services.map(s => `<option value="${s.id}">${s.icon} ${s.name}</option>`).join('');
  filterEl.value = currentVal;

  const serviceSelect = document.getElementById('cookieService');
  serviceSelect.innerHTML = services.map(s => `<option value="${s.id}">${s.icon} ${s.name}</option>`).join('');

  const sid = filterEl.value;
  const url = sid ? `/api/cookies?service_id=${sid}` : '/api/cookies';
  const cookies = await API.get(url);
  if (!cookies) return;
  if (cookies.length === 0) {
    document.getElementById('cookiesTable').innerHTML = '<div class="empty-state"><p>No cookies found. Click "Add Cookie" to add one.</p></div>';
    return;
  }
  document.getElementById('cookiesTable').innerHTML = `<table><thead><tr><th>Service</th><th>Label</th><th>Name</th><th>Value</th><th>Domain</th><th>Status</th><th>Actions</th></tr></thead><tbody>${cookies.map(c => `<tr>
    <td>${c.service_name}</td>
    <td>${c.label}</td>
    <td><code>${c.cookie_name}</code></td>
    <td class="cookie-value-cell" title="${escapeAttr(c.cookie_value)}">${c.cookie_value.substring(0, 30)}${c.cookie_value.length > 30 ? '...' : ''}</td>
    <td>${c.cookie_domain}</td>
    <td><span class="badge ${c.enabled ? 'badge-success' : 'badge-danger'}">${c.enabled ? 'Active' : 'Disabled'}</span></td>
    <td class="actions-cell">
      <button class="btn btn-outline btn-sm" onclick="editCookie(${c.id})">Edit</button>
      <button class="btn btn-danger btn-sm" onclick="deleteCookie(${c.id})">Delete</button>
    </td>
  </tr>`).join('')}</tbody></table>`;
}

function escapeAttr(str) {
  return str.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

async function loadSettings() {
  const settings = await API.get('/api/settings');
  if (!settings) return;
  document.getElementById('setting-extension_name').value = settings.extension_name || '';
  document.getElementById('setting-extension_version').value = settings.extension_version || '';
  document.getElementById('setting-theme').value = settings.theme || 'dark';
  const apiKeyEl = document.getElementById('apiKeyDisplay');
  const serverUrlEl = document.getElementById('serverUrlDisplay');
  apiKeyEl.textContent = settings.api_key || 'No key set';
  serverUrlEl.textContent = window.location.origin;

  function copyText(el) {
    navigator.clipboard.writeText(el.textContent).then(() => showToast('Copied to clipboard!'));
  }
  apiKeyEl.onclick = () => copyText(apiKeyEl);
  serverUrlEl.onclick = () => copyText(serverUrlEl);
}

document.getElementById('cookieDomain').addEventListener('blur', (e) => {
  let val = e.target.value.trim();
  if (val.startsWith('http')) {
    try {
      const url = new URL(val);
      e.target.value = '.' + url.hostname.replace(/^www\./, '');
    } catch(e) {}
  }
});

document.getElementById('bulkImportBtn').addEventListener('click', () => {
  const serviceSelect = document.getElementById('bulkService');
  serviceSelect.innerHTML = servicesCache.map(s => `<option value="${s.id}">${s.icon} ${s.name}</option>`).join('');
  document.getElementById('bulkLabel').value = '';
  document.getElementById('bulkJson').value = '';
  document.getElementById('bulkDomain').value = '';
  openModal('bulkModal');
});

document.getElementById('processBulkBtn').addEventListener('click', async () => {
  const jsonStr = document.getElementById('bulkJson').value;
  let cookies;
  try {
    cookies = JSON.parse(jsonStr);
  } catch (e) {
    showToast('Invalid JSON format', 'error');
    return;
  }

  const data = {
    service_id: parseInt(document.getElementById('bulkService').value),
    label: document.getElementById('bulkLabel').value || 'Bulk Import',
    cookies: cookies,
    cookie_domain: document.getElementById('bulkDomain').value,
    cookie_path: document.getElementById('bulkPath').value || '/',
    same_site: document.getElementById('bulkSameSite').value,
    expiry: parseInt(document.getElementById('bulkExpiry').value) || 0,
    secure: document.getElementById('bulkSecure').checked,
    http_only: document.getElementById('bulkHttpOnly').checked
  };

  if (!data.cookie_domain) {
    showToast('Cookie domain is required', 'error');
    return;
  }

  const res = await API.post('/api/cookies/bulk', data);
  if (res.success) {
    showToast(`Successfully imported ${res.count} cookies`);
    closeModal('bulkModal');
    loadCookies();
  } else {
    showToast(res.error || 'Import failed', 'error');
  }
});

document.getElementById('addServiceBtn').addEventListener('click', () => {
  document.getElementById('serviceModalTitle').textContent = 'Add Service';
  document.getElementById('serviceId').value = '';
  document.getElementById('serviceName').value = '';
  document.getElementById('serviceDomain').value = '';
  document.getElementById('serviceIcon').value = '';
  document.getElementById('serviceCategory').value = 'productivity';
  openModal('serviceModal');
});

window.editService = async function(id) {
  const s = servicesCache.find(x => x.id === id);
  if (!s) return;
  document.getElementById('serviceModalTitle').textContent = 'Edit Service';
  document.getElementById('serviceId').value = s.id;
  document.getElementById('serviceName').value = s.name;
  document.getElementById('serviceDomain').value = s.domain;
  document.getElementById('serviceIcon').value = s.icon;
  document.getElementById('serviceCategory').value = s.category;
  openModal('serviceModal');
};

document.getElementById('saveServiceBtn').addEventListener('click', async () => {
  const id = document.getElementById('serviceId').value;
  const data = {
    name: document.getElementById('serviceName').value,
    domain: document.getElementById('serviceDomain').value,
    icon: document.getElementById('serviceIcon').value || '🌐',
    category: document.getElementById('serviceCategory').value,
    enabled: true,
  };
  if (!data.name || !data.domain) { showToast('Name and domain are required', 'error'); return; }
  if (id) {
    await API.put(`/api/services/${id}`, data);
    showToast('Service updated');
  } else {
    await API.post('/api/services', data);
    showToast('Service added');
  }
  closeModal('serviceModal');
  loadServices();
});

window.deleteService = async function(id, name) {
  if (!confirm(`Delete "${name}" and all its cookies?`)) return;
  await API.del(`/api/services/${id}`);
  showToast('Service deleted');
  loadServices();
};

document.getElementById('addCookieBtn').addEventListener('click', () => {
  document.getElementById('cookieModalTitle').textContent = 'Add Cookie';
  document.getElementById('cookieId').value = '';
  document.getElementById('cookieLabel').value = '';
  document.getElementById('cookieName').value = '';
  document.getElementById('cookieValue').value = '';
  document.getElementById('cookieDomain').value = '';
  document.getElementById('cookiePath').value = '/';
  document.getElementById('cookieSameSite').value = 'lax';
  document.getElementById('cookieExpiry').value = '0';
  document.getElementById('cookieSecure').checked = true;
  document.getElementById('cookieHttpOnly').checked = false;
  openModal('cookieModal');
});

window.editCookie = async function(id) {
  const cookies = await API.get('/api/cookies');
  const c = cookies.find(x => x.id === id);
  if (!c) return;
  document.getElementById('cookieModalTitle').textContent = 'Edit Cookie';
  document.getElementById('cookieId').value = c.id;
  document.getElementById('cookieService').value = c.service_id;
  document.getElementById('cookieLabel').value = c.label;
  document.getElementById('cookieName').value = c.cookie_name;
  document.getElementById('cookieValue').value = c.cookie_value;
  document.getElementById('cookieDomain').value = c.cookie_domain;
  document.getElementById('cookiePath').value = c.cookie_path;
  document.getElementById('cookieSameSite').value = c.same_site;
  document.getElementById('cookieExpiry').value = c.expiry;
  document.getElementById('cookieSecure').checked = !!c.secure;
  document.getElementById('cookieHttpOnly').checked = !!c.http_only;
  openModal('cookieModal');
};

document.getElementById('saveCookieBtn').addEventListener('click', async () => {
  const id = document.getElementById('cookieId').value;
  const data = {
    service_id: parseInt(document.getElementById('cookieService').value),
    label: document.getElementById('cookieLabel').value || 'Default',
    cookie_name: document.getElementById('cookieName').value,
    cookie_value: document.getElementById('cookieValue').value,
    cookie_domain: document.getElementById('cookieDomain').value,
    cookie_path: document.getElementById('cookiePath').value || '/',
    same_site: document.getElementById('cookieSameSite').value,
    expiry: parseInt(document.getElementById('cookieExpiry').value) || 0,
    secure: document.getElementById('cookieSecure').checked,
    http_only: document.getElementById('cookieHttpOnly').checked,
    enabled: true,
  };
  if (!data.cookie_name || !data.cookie_value || !data.cookie_domain) {
    showToast('Cookie name, value, and domain are required', 'error');
    return;
  }
  if (id) {
    await API.put(`/api/cookies/${id}`, data);
    showToast('Cookie updated');
  } else {
    await API.post('/api/cookies', data);
    showToast('Cookie added');
  }
  closeModal('cookieModal');
  loadCookies();
});

window.deleteCookie = async function(id) {
  if (!confirm('Delete this cookie?')) return;
  await API.del(`/api/cookies/${id}`);
  showToast('Cookie deleted');
  loadCookies();
};

document.getElementById('cookieServiceFilter').addEventListener('change', loadCookies);

document.getElementById('settingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  await API.put('/api/settings', {
    extension_name: document.getElementById('setting-extension_name').value,
    extension_version: document.getElementById('setting-extension_version').value,
    theme: document.getElementById('setting-theme').value,
  });
  showToast('Settings saved');
});

document.getElementById('regenerateKeyBtn').addEventListener('click', async () => {
  if (!confirm('Regenerate API key? The extension will need updating.')) return;
  const res = await API.post('/api/settings/regenerate-key');
  document.getElementById('apiKeyDisplay').textContent = res.api_key;
  showToast('API key regenerated');
});

document.getElementById('passwordForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const res = await API.post('/api/auth/change-password', {
    current_password: document.getElementById('currentPassword').value,
    new_password: document.getElementById('newPassword').value,
  });
  if (res.success) {
    showToast('Password updated');
    document.getElementById('currentPassword').value = '';
    document.getElementById('newPassword').value = '';
  } else {
    showToast(res.error || 'Failed', 'error');
  }
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await API.post('/api/auth/logout');
  window.location.href = '/login';
});

const hash = window.location.hash.replace('#', '') || 'dashboard';
const navLink = document.querySelector(`[data-page="${hash}"]`);
if (navLink) navLink.click();
else loadDashboard();
