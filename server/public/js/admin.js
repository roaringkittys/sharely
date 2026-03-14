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
    case 'users': await loadUsers(); break;
    case 'tokens': await loadTokens(); break;
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
  
  // Add Extractor Snippet Section
  const snippet = `(async()=>{const c=await cookieStore.getAll();const o=Object.fromEntries(c.map(i=>[i.name,i.value]));const s=JSON.stringify(o);const t=document.createElement('textarea');t.value=s;document.body.appendChild(t);t.select();document.execCommand('copy');document.body.removeChild(t);console.log('✅ '+c.length+' cookies copied to clipboard!');})();`;
  
  const cookies = await API.get('/api/cookies');
  if (!cookies) return;
  
  let html = `
    <div class="dashboard-section" style="margin-top:20px; padding:20px; background: rgba(255,255,255,0.05); border-radius:12px; border:1px solid rgba(255,255,255,0.1)">
      <h3>🍪 Easy Cookie Extractor</h3>
      <p style="font-size: 13px; opacity: 0.8; margin-bottom: 10px;">To copy cookies from any site (Netflix, etc.) as JSON, open DevTools Console (F12) and paste this:</p>
      <div style="display:flex; gap:10px; align-items:center;">
        <code style="background:#000; padding:10px; border-radius:6px; flex:1; font-size:12px; color:#0f0; border:1px solid #333;">${snippet}</code>
        <button class="btn btn-outline btn-sm" onclick="navigator.clipboard.writeText(\`${snippet}\`).then(() => showToast('Snippet copied!'))">Copy Snippet</button>
      </div>
    </div>
    <h3 style="margin-top:30px">Recent Cookies</h3>
  `;
  
  if (cookies.length === 0) {
    html += '<div class="empty-state"><p>No cookies added yet. Go to Cookies page to add some.</p></div>';
  } else {
    const recent = cookies.slice(0, 5);
    html += `<table><thead><tr><th>Service</th><th>Label</th><th>Cookie Name</th><th>Domain</th><th>Status</th></tr></thead><tbody>${recent.map(c => `<tr><td>${c.service_name}</td><td>${c.label}</td><td><code>${c.cookie_name}</code></td><td>${c.cookie_domain}</td><td><span class="badge ${c.enabled ? 'badge-success' : 'badge-danger'}">${c.enabled ? 'Active' : 'Disabled'}</span></td></tr>`).join('')}</tbody></table>`;
  }
  document.getElementById('recentCookiesTable').innerHTML = html;
}

async function loadServices() {
  const services = await API.get('/api/services');
  if (!services) return;
  servicesCache = services;
  if (services.length === 0) {
    document.getElementById('servicesTable').innerHTML = '<div class="empty-state"><p>No services yet. Click "Add Service" to get started.</p></div>';
    return;
  }

  // Separate parents and children
  const parents = services.filter(s => !s.parent_id);
  const childrenOf = {};
  services.filter(s => s.parent_id).forEach(s => {
    if (!childrenOf[s.parent_id]) childrenOf[s.parent_id] = [];
    childrenOf[s.parent_id].push(s);
  });

  const rows = [];
  parents.forEach(s => {
    const children = childrenOf[s.id] || [];
    const childCount = children.length;
    const iconCell = s.icon_url
      ? `<img src="${s.icon_url}" style="width:36px;height:36px;border-radius:8px;object-fit:cover">`
      : `<span style="font-size:24px">${s.icon || '🌐'}</span>`;
    const namePart = childCount > 0
      ? `<strong>${s.name}</strong> <span class="badge badge-info" style="margin-left:4px">${childCount} sub-services</span>`
      : `<strong>${s.name}</strong>`;

    rows.push(`<tr>
      <td>${iconCell}</td>
      <td>${namePart}</td>
      <td><code>${s.domain}</code></td>
      <td><span class="badge badge-info">${s.category}</span></td>
      <td><span class="badge ${s.enabled ? 'badge-success' : 'badge-danger'}">${s.enabled ? 'Active' : 'Disabled'}</span></td>
      <td class="actions-cell">
        <button class="btn btn-outline btn-sm" onclick="editService(${s.id})">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteService(${s.id}, '${s.name}')">Delete</button>
      </td>
    </tr>`);

    // Render children indented under parent
    children.forEach(c => {
      const cIcon = c.icon_url
        ? `<img src="${c.icon_url}" style="width:28px;height:28px;border-radius:6px;object-fit:cover">`
        : `<span style="font-size:20px">${c.icon || '🌐'}</span>`;
      rows.push(`<tr style="background:rgba(108,92,231,0.05)">
        <td style="padding-left:24px">${cIcon}</td>
        <td style="padding-left:8px"><span style="color:#888;margin-right:6px">↳</span>${c.name}</td>
        <td><code>${c.domain}</code></td>
        <td><span class="badge badge-info">${c.category}</span></td>
        <td><span class="badge ${c.enabled ? 'badge-success' : 'badge-danger'}">${c.enabled ? 'Active' : 'Disabled'}</span></td>
        <td class="actions-cell">
          <button class="btn btn-outline btn-sm" onclick="editService(${c.id})">Edit</button>
          <button class="btn btn-danger btn-sm" onclick="deleteService(${c.id}, '${c.name}')">Delete</button>
        </td>
      </tr>`);
    });
  });

  document.getElementById('servicesTable').innerHTML = `<table><thead><tr><th>Logo</th><th>Name</th><th>Domain</th><th>Category</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

function populateParentDropdown(excludeId = null) {
  const select = document.getElementById('serviceParent');
  const topLevel = servicesCache.filter(s => !s.parent_id && s.id !== excludeId);
  select.innerHTML = '<option value="">— Top-level service (no parent) —</option>' +
    topLevel.map(s => `<option value="${s.id}">${s.icon || '🌐'} ${s.name}</option>`).join('');
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

document.getElementById('bulkDomain').addEventListener('blur', (e) => {
  let val = e.target.value.trim();
  if (val.startsWith('http')) {
    try {
      const url = new URL(val);
      e.target.value = '.' + url.hostname.replace(/^www\./, '');
    } catch(e) {}
  } else if (val && !val.startsWith('.')) {
    e.target.value = '.' + val;
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
    same_site: 'no_restriction',
    expiry: parseInt(document.getElementById('bulkExpiry').value) || 0,
    secure: true,
    http_only: true
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

function resetServiceIconUI(iconUrl) {
  const preview = document.getElementById('serviceIconPreview');
  const removeBtn = document.getElementById('removeIconBtn');
  document.getElementById('serviceIconFile').value = '';
  document.getElementById('iconUploadStatus').textContent = '';
  if (iconUrl) {
    preview.src = iconUrl;
    preview.style.display = 'block';
    removeBtn.style.display = 'inline-block';
  } else {
    preview.src = '';
    preview.style.display = 'none';
    removeBtn.style.display = 'none';
  }
}

document.getElementById('uploadIconBtn').addEventListener('click', () => {
  document.getElementById('serviceIconFile').click();
});

document.getElementById('serviceIconFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const preview = document.getElementById('serviceIconPreview');
  const reader = new FileReader();
  reader.onload = (ev) => {
    preview.src = ev.target.result;
    preview.style.display = 'block';
    document.getElementById('iconUploadStatus').textContent = `Ready to upload: ${file.name}`;
  };
  reader.readAsDataURL(file);
});

document.getElementById('removeIconBtn').addEventListener('click', async () => {
  const id = document.getElementById('serviceId').value;
  if (!id) { resetServiceIconUI(null); return; }
  await fetch(`/api/services/${id}/upload-icon`, { method: 'DELETE' });
  resetServiceIconUI(null);
  showToast('Logo removed');
  loadServices();
});

document.getElementById('addServiceBtn').addEventListener('click', () => {
  document.getElementById('serviceModalTitle').textContent = 'Add Service';
  document.getElementById('serviceId').value = '';
  document.getElementById('serviceName').value = '';
  document.getElementById('serviceDomain').value = '';
  document.getElementById('serviceIcon').value = '';
  document.getElementById('serviceCategory').value = 'productivity';
  resetServiceIconUI(null);
  populateParentDropdown(null);
  document.getElementById('serviceParent').value = '';
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
  resetServiceIconUI(s.icon_url || null);
  populateParentDropdown(s.id);
  document.getElementById('serviceParent').value = s.parent_id || '';
  openModal('serviceModal');
};

document.getElementById('saveServiceBtn').addEventListener('click', async () => {
  const id = document.getElementById('serviceId').value;
  const parentVal = document.getElementById('serviceParent').value;
  const data = {
    name: document.getElementById('serviceName').value,
    domain: document.getElementById('serviceDomain').value,
    icon: document.getElementById('serviceIcon').value || '🌐',
    category: document.getElementById('serviceCategory').value,
    enabled: true,
    parent_id: parentVal ? parseInt(parentVal) : null,
  };
  if (!data.name || !data.domain) { showToast('Name and domain are required', 'error'); return; }

  let serviceId = id;
  if (id) {
    await API.put(`/api/services/${id}`, data);
  } else {
    const res = await API.post('/api/services', data);
    serviceId = res.id;
  }

  // Upload icon if a file was selected
  const fileInput = document.getElementById('serviceIconFile');
  if (fileInput.files.length > 0 && serviceId) {
    const formData = new FormData();
    formData.append('icon', fileInput.files[0]);
    const uploadRes = await fetch(`/api/services/${serviceId}/upload-icon`, {
      method: 'POST',
      body: formData
    });
    const uploadJson = await uploadRes.json();
    if (!uploadJson.success) showToast('Icon upload failed: ' + uploadJson.error, 'error');
  }

  showToast(id ? 'Service updated' : 'Service added');
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

// ── Users Page ─────────────────────────────────────────────────────────────

async function loadUsers() {
  const [users, analytics] = await Promise.all([
    API.get('/admin/users'),
    API.get('/admin/analytics')
  ]);
  if (!users) return;

  if (analytics) {
    document.getElementById('userAnalytics').textContent =
      `${analytics.activeUsers} active · ${analytics.expiredUsers} expired · ${analytics.activeSessions} sessions online`;
  }

  if (users.length === 0) {
    document.getElementById('usersTable').innerHTML = '<div class="empty-state"><p>No users registered yet. Share the <a href="/register" target="_blank" style="color:var(--primary)">registration page</a> with your users.</p></div>';
    return;
  }

  document.getElementById('usersTable').innerHTML = `
    <table>
      <thead><tr>
        <th>Email</th>
        <th>Status</th>
        <th>Access Expires</th>
        <th>Last Seen</th>
        <th>Registered</th>
        <th>Actions</th>
      </tr></thead>
      <tbody>
        ${users.map(u => {
          const expired = u.is_expired;
          const active = u.is_active && !expired;
          const statusBadge = !u.is_active
            ? '<span class="badge badge-danger">Revoked</span>'
            : expired
              ? '<span class="badge badge-warning">Expired</span>'
              : '<span class="badge badge-success">Active</span>';
          const expiresStr = u.access_expires_at ? new Date(u.access_expires_at).toLocaleDateString() : '—';
          const lastSeen = u.last_seen ? new Date(u.last_seen).toLocaleString() : 'Never';
          const registered = new Date(u.created_at).toLocaleDateString();
          return `<tr>
            <td><strong>${escapeHtml(u.email)}</strong></td>
            <td>${statusBadge}</td>
            <td>${expiresStr}</td>
            <td style="font-size:12px;color:var(--text-secondary)">${lastSeen}</td>
            <td style="font-size:12px;color:var(--text-secondary)">${registered}</td>
            <td style="white-space:nowrap">
              ${u.is_active
                ? `<button class="btn btn-outline btn-sm" onclick="revokeUser(${u.id},'${escapeAttr(u.email)}')">Revoke</button>`
                : `<button class="btn btn-outline btn-sm" onclick="restoreUser(${u.id})">Restore</button>`}
              <button class="btn btn-outline btn-sm" style="margin-left:6px" onclick="resetDevice(${u.id},'${escapeAttr(u.email)}')" title="Reset device binding">Reset Device</button>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

async function revokeUser(id, email) {
  if (!confirm(`Revoke access for "${email}"? They won't be able to log in.`)) return;
  const res = await API.del(`/admin/users/${id}`);
  if (res.success) { showToast('User revoked'); loadUsers(); }
}

async function restoreUser(id) {
  const res = await API.post(`/admin/users/${id}/restore`, {});
  if (res.success) { showToast('User restored'); loadUsers(); }
}

async function resetDevice(id, email) {
  if (!confirm(`Reset device binding for "${email}"? They can log in from any device once.`)) return;
  const res = await API.del(`/admin/users/${id}/device`);
  if (res.success) { showToast('Device reset'); loadUsers(); }
}

// ── Tokens Page ─────────────────────────────────────────────────────────────

async function loadTokens() {
  const tokens = await API.get('/admin/tokens');
  if (!tokens) return;

  if (tokens.length === 0) {
    document.getElementById('tokensTable').innerHTML = '<div class="empty-state"><p>No tokens yet. Generate some above.</p></div>';
    return;
  }

  document.getElementById('tokensTable').innerHTML = `
    <table>
      <thead><tr>
        <th>Token</th>
        <th>Duration</th>
        <th>Status</th>
        <th>Used By</th>
        <th>Expires</th>
        <th>Actions</th>
      </tr></thead>
      <tbody>
        ${tokens.map(t => {
          const statusBadge = t.used
            ? `<span class="badge badge-success">Used</span>`
            : t.is_expired
              ? `<span class="badge badge-danger">Expired</span>`
              : `<span class="badge badge-warning">Available</span>`;
          const expiresStr = new Date(t.expires_at).toLocaleDateString();
          const usedBy = t.used_by ? escapeHtml(t.used_by) : '—';
          return `<tr>
            <td><code style="font-size:11px;cursor:pointer" onclick="navigator.clipboard.writeText('${t.token}');showToast('Token copied')" title="Click to copy">${t.token.substring(0,16)}...</code></td>
            <td>${t.duration_days}d</td>
            <td>${statusBadge}</td>
            <td style="font-size:12px;color:var(--text-secondary)">${usedBy}</td>
            <td style="font-size:12px">${expiresStr}</td>
            <td>
              <button class="btn btn-outline btn-sm" onclick="deleteToken(${t.id})">Delete</button>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

async function deleteToken(id) {
  if (!confirm('Delete this token?')) return;
  const res = await API.del(`/admin/tokens/${id}`);
  if (res.success) { showToast('Token deleted'); loadTokens(); }
}

document.getElementById('generateTokensBtn').addEventListener('click', async () => {
  const count = parseInt(document.getElementById('tokenCount').value) || 10;
  const durationDays = parseInt(document.getElementById('tokenDuration').value) || 30;
  const btn = document.getElementById('generateTokensBtn');
  btn.disabled = true;
  btn.textContent = 'Generating...';

  const res = await API.post('/admin/generate-tokens', { count, durationDays });
  btn.disabled = false;
  btn.textContent = 'Generate';

  if (res && res.success) {
    const box = document.getElementById('generatedTokensBox');
    document.getElementById('generatedTokensText').value = res.tokens.join('\n');
    box.style.display = 'block';
    showToast(`${res.count} tokens generated`);
    loadTokens();
  } else {
    showToast((res && res.error) || 'Failed', 'error');
  }
});

document.getElementById('copyTokensBtn').addEventListener('click', () => {
  const text = document.getElementById('generatedTokensText').value;
  navigator.clipboard.writeText(text);
  showToast('All tokens copied to clipboard');
});

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

const hash = window.location.hash.replace('#', '') || 'dashboard';
const navLink = document.querySelector(`[data-page="${hash}"]`);
if (navLink) navLink.click();
else loadDashboard();
