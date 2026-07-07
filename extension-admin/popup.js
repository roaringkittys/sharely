/* popup.js — Sharely Manager (Admin) v2.0 */
/* Session Profile Manager: create, sync, view, delete profiles per domain */

// ── Storage helpers ───────────────────────────────────────────────────────────────────────────

async function loadStorage() {
  return new Promise(resolve =>
    chrome.storage.local.get(
      ['serverUrl', 'apiKey', 'syncLog'],
      resolve
    )
  );
}

async function saveStorage(data) {
  return new Promise(resolve => chrome.storage.local.set(data, resolve));
}

// ── Helpers ────────────────────────────────────────────────────────────────────────────────────

function setStatus(msg, type = 'muted') {
  const el = document.getElementById('statusMsg');
  el.textContent = msg;
  el.className = 'status-msg ' + type;
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── State ──────────────────────────────────────────────────────────────────────────────────────────────

let activeDomain = null;
let activeTabTitle = '';
let activeCookieCount = 0;

// ── Render profiles ──────────────────────────────────────────────────────────────────────────────

async function renderProfiles() {
  const result = await chrome.runtime.sendMessage({ type: 'GET_PROFILES', domain: activeDomain });
  const profiles = result.success ? result.profiles : [];

  document.getElementById('profileCount').textContent = profiles.length;
  const list = document.getElementById('profileList');

  if (profiles.length === 0) {
    list.innerHTML = '<div class="empty-state">No profiles saved yet for this site.<br>Create one above to start.</div>';
    return;
  }

  list.innerHTML = profiles.map(p => {
    const updated = p.updatedAt ? timeAgo(p.updatedAt) : 'never';
    return `
      <div class="profile-card">
        <div class="profile-card-left">
          <div class="profile-name">${escapeHtml(p.name)}</div>
          <div class="profile-meta">${p.cookieCount || 0} cookies · ${updated}</div>
        </div>
        <div class="profile-actions">
          <button class="profile-btn profile-btn-sync" data-id="${p.id}" title="Sync current session to this profile">↑ Sync</button>
          <button class="profile-btn profile-btn-view" data-id="${p.id}" title="View cookies">View</button>
          <button class="profile-btn profile-btn-del" data-id="${p.id}" title="Delete profile">✕</button>
        </div>
      </div>`;
  }).join('');

  // Sync button: overwrite profile with current tab cookies
  list.querySelectorAll('.profile-btn-sync').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const name = profiles.find(p => p.id === id)?.name || '';
      btn.disabled = true;
      btn.textContent = '…';
      setStatus(`Syncing ${name}…`, 'muted');

      const result = await chrome.runtime.sendMessage({ type: 'SAVE_PROFILE', id, name, domain: activeDomain });

      btn.disabled = false;
      btn.textContent = '↑ Sync';
      if (result.success) {
        setStatus(`✓ ${result.cookieCount} cookies saved to "${name}"`, 'ok');
        await renderProfiles();
      } else {
        setStatus(`✗ ${result.error}`, 'err');
      }
    });
  });

  // View button: show cookies overlay
  list.querySelectorAll('.profile-btn-view').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const profile = profiles.find(p => p.id === id);
      if (!profile) return;
      showCookiesOverlay(profile);
    });
  });

  // Delete button
  list.querySelectorAll('.profile-btn-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const profile = profiles.find(p => p.id === id);
      if (!confirm(`Delete "${profile?.name}"? This cannot be undone.`)) return;
      await chrome.runtime.sendMessage({ type: 'DELETE_PROFILE', id });
      setStatus(`Deleted "${profile?.name}"`, 'ok');
      await renderProfiles();
    });
  });
}

function escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function showCookiesOverlay(profile) {
  document.getElementById('cookiesOverlayTitle').textContent = `${escapeHtml(profile.name)} — Cookies`;
  const container = document.getElementById('cookiesOverlayList');
  const cookies = profile.cookies || [];
  if (cookies.length === 0) {
    container.innerHTML = '<div class="empty-state">No cookies stored.</div>';
  } else {
    container.innerHTML = cookies.map(c => `
      <div class="log-entry">
        <div class="log-domain">${escapeHtml(c.name)}</div>
        <div class="log-detail">
          domain: ${escapeHtml(c.domain || '')} · path: ${escapeHtml(c.path || '/')} · secure: ${c.secure} · httpOnly: ${c.httpOnly} · sameSite: ${escapeHtml(c.sameSite || 'lax')}
        </div>
      </div>`).join('');
  }
  document.getElementById('cookiesOverlay').classList.add('open');
}

// ── Render sync log ────────────────────────────────────────────────────────────────────────────

async function renderLog() {
  const stored = await loadStorage();
  const log = stored.syncLog || [];
  const container = document.getElementById('logEntries');

  if (log.length === 0) {
    container.innerHTML = '<div class="empty-state">No syncs yet.</div>';
    return;
  }

  container.innerHTML = log.map(entry => {
    const detail = entry.ok
      ? `<span class="log-ok">✓ ${entry.count} cookies — ${entry.label}</span>`
      : `<span class="log-err">✗ ${entry.error}</span>`;
    return `
      <div class="log-entry">
        <div class="log-domain">${entry.domain}</div>
        <div class="log-detail">${detail} · ${timeAgo(entry.ts)}</div>
      </div>`;
  }).join('');
}

// ── Init ──────────────────────────────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  const stored = await loadStorage();

  // Pre-fill settings
  document.getElementById('inputServerUrl').value = stored.serverUrl || '';
  document.getElementById('inputApiKey').value = stored.apiKey || '';

  // Get active tab info from background
  const tabInfo = await chrome.runtime.sendMessage({ type: 'GET_ACTIVE_COOKIES' });
  activeDomain = tabInfo.domain || null;
  activeTabTitle = tabInfo.tabTitle || '';
  activeCookieCount = tabInfo.count || 0;

  if (activeDomain) {
    document.getElementById('siteDomain').textContent = activeDomain;
    document.getElementById('siteTitle').textContent = activeTabTitle;
    document.getElementById('cookieCount').textContent = `${activeCookieCount} cookie${activeCookieCount !== 1 ? 's' : ''}`;
  } else {
    document.getElementById('siteDomain').textContent = 'No active site';
    document.getElementById('cookieCount').textContent = '';
    document.getElementById('addProfileBtn').disabled = true;
    document.getElementById('newProfileName').disabled = true;
    setStatus('Navigate to a website to manage profiles', 'muted');
  }

  await renderProfiles();

  // Add profile
  document.getElementById('addProfileBtn').addEventListener('click', async () => {
    if (!activeDomain) return;
    const input = document.getElementById('newProfileName');
    const name = input.value.trim();
    if (!name) {
      setStatus('Enter a profile name first', 'err');
      return;
    }
    const btn = document.getElementById('addProfileBtn');
    btn.disabled = true;
    btn.textContent = '…';
    setStatus(`Creating "${name}" and saving current session…`, 'muted');

    const result = await chrome.runtime.sendMessage({ type: 'SAVE_PROFILE', name, domain: activeDomain });

    btn.disabled = false;
    btn.textContent = '+';
    if (result.success) {
      input.value = '';
      setStatus(`✓ Created "${name}" with ${result.cookieCount} cookies`, 'ok');
      await renderProfiles();
    } else {
      setStatus(`✗ ${result.error}`, 'err');
    }
  });

  // Enter key on input
  document.getElementById('newProfileName').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('addProfileBtn').click();
  });

  // Settings overlay
  document.getElementById('settingsBtn').addEventListener('click', () => {
    document.getElementById('settingsOverlay').classList.add('open');
  });
  document.getElementById('settingsClose').addEventListener('click', () => {
    document.getElementById('settingsOverlay').classList.remove('open');
  });
  document.getElementById('settingsOverlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('settingsOverlay')) {
      document.getElementById('settingsOverlay').classList.remove('open');
    }
  });

  document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
    const url = document.getElementById('inputServerUrl').value.trim().replace(/\/+$/, '');
    const key = document.getElementById('inputApiKey').value.trim();
    await saveStorage({ serverUrl: url, apiKey: key });
    document.getElementById('settingsOverlay').classList.remove('open');
    setStatus('Settings saved', 'ok');
    setTimeout(() => setStatus('Ready', 'muted'), 2000);
  });

  // Sync Log overlay
  document.getElementById('viewLogBtn').addEventListener('click', async () => {
    await renderLog();
    document.getElementById('logOverlay').classList.add('open');
  });
  document.getElementById('logClose').addEventListener('click', () => {
    document.getElementById('logOverlay').classList.remove('open');
  });
  document.getElementById('logOverlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('logOverlay')) {
      document.getElementById('logOverlay').classList.remove('open');
    }
  });

  // Cookies overlay close
  document.getElementById('cookiesClose').addEventListener('click', () => {
    document.getElementById('cookiesOverlay').classList.remove('open');
  });
  document.getElementById('cookiesOverlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('cookiesOverlay')) {
      document.getElementById('cookiesOverlay').classList.remove('open');
    }
  });
});
