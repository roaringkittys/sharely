/* popup.js — Sharely Manager (Admin) v1.1 */

// ── Storage helpers ───────────────────────────────────────────────────────────

async function loadStorage() {
  return new Promise(resolve =>
    chrome.storage.local.get(
      ['serverUrl', 'apiKey', 'trackedDomains', 'cookieHashes', 'syncLog'],
      resolve
    )
  );
}

async function saveStorage(data) {
  return new Promise(resolve => chrome.storage.local.set(data, resolve));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// ── Render tracked domains list ───────────────────────────────────────────────

async function renderDomainList(activeDomain) {
  const stored = await loadStorage();
  const domains = stored.trackedDomains || [];
  const log = stored.syncLog || [];
  const list = document.getElementById('domainList');
  const countEl = document.getElementById('watchCount');

  countEl.textContent = domains.length;

  if (domains.length === 0) {
    list.innerHTML = '<div class="empty-state">No sites watched yet.<br>Enable "Auto-sync this site" above to start.</div>';
    return;
  }

  list.innerHTML = domains.map(domain => {
    const lastEntry = log.find(e => e.domain === domain);
    const lastText = lastEntry
      ? (lastEntry.ok
          ? `✓ ${lastEntry.count} cookies — ${timeAgo(lastEntry.ts)}`
          : `✗ ${lastEntry.error} — ${timeAgo(lastEntry.ts)}`)
      : 'Never synced';
    const lastClass = lastEntry ? (lastEntry.ok ? 'log-ok' : 'log-err') : '';
    const active = domain === activeDomain ? ' style="border-color:rgba(108,92,231,0.5)"' : '';
    return `
      <div class="domain-item"${active}>
        <div class="domain-item-left">
          <div class="domain-name">${domain}</div>
          <div class="domain-last ${lastClass}">${lastText}</div>
        </div>
        <div class="domain-actions">
          <button class="domain-sync-btn" data-domain="${domain}" title="Sync now">↑</button>
          <button class="domain-remove-btn" data-domain="${domain}" title="Stop watching">✕</button>
        </div>
      </div>`;
  }).join('');

  list.querySelectorAll('.domain-sync-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const domain = btn.dataset.domain;
      btn.disabled = true;
      btn.textContent = '…';
      setStatus(`Syncing ${domain}…`, 'muted');
      const result = await chrome.runtime.sendMessage({ type: 'SYNC_DOMAIN', domain, forced: true });
      btn.disabled = false;
      btn.textContent = '↑';
      if (result.success) {
        setStatus(`✓ Synced ${result.count} cookies for ${domain}`, 'ok');
      } else if (result.skipped) {
        const reasonMap = {
          no_api_key: '✗ No API key — open Settings',
          no_tab: 'No open tab for this site — keep the site open in another tab',
          no_cookies: 'No readable cookies found',
          unchanged: 'No changes since last sync',
        };
        setStatus(reasonMap[result.reason] || result.reason, result.reason === 'no_api_key' ? 'err' : 'muted');
      } else {
        setStatus(`✗ ${result.error}`, 'err');
      }
      await renderDomainList(activeDomain);
    });
  });

  list.querySelectorAll('.domain-remove-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const domain = btn.dataset.domain;
      const stored = await loadStorage();
      const domains = (stored.trackedDomains || []).filter(d => d !== domain);
      await saveStorage({ trackedDomains: domains });
      if (domain === activeDomain) {
        document.getElementById('watchToggle').checked = false;
      }
      await renderDomainList(activeDomain);
    });
  });
}

// ── Render sync log ───────────────────────────────────────────────────────────

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

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  const stored = await loadStorage();

  // Pre-fill settings
  document.getElementById('inputServerUrl').value = stored.serverUrl || '';
  document.getElementById('inputApiKey').value = stored.apiKey || '';

  // Get active tab info from background
  const tabInfo = await chrome.runtime.sendMessage({ type: 'GET_ACTIVE_COOKIES' });
  const activeDomain = tabInfo.domain || null;

  if (activeDomain) {
    document.getElementById('siteDomain').textContent = activeDomain;
    document.getElementById('siteTitle').textContent = tabInfo.tabTitle || '';
    document.getElementById('cookieCount').textContent = `${tabInfo.count} cookie${tabInfo.count !== 1 ? 's' : ''}`;
  } else {
    document.getElementById('siteDomain').textContent = 'No active site';
    document.getElementById('cookieCount').textContent = '';
    document.getElementById('syncBtn').disabled = true;
    setStatus('Navigate to a website to sync cookies', 'muted');
  }

  const domains = stored.trackedDomains || [];
  document.getElementById('watchToggle').checked = activeDomain ? domains.includes(activeDomain) : false;

  await renderDomainList(activeDomain);

  // Watch toggle
  document.getElementById('watchToggle').addEventListener('change', async (e) => {
    if (!activeDomain) return;
    const stored = await loadStorage();
    let domains = stored.trackedDomains || [];
    if (e.target.checked) {
      if (!domains.includes(activeDomain)) domains.push(activeDomain);
      setStatus(`Now watching ${activeDomain}`, 'ok');
    } else {
      domains = domains.filter(d => d !== activeDomain);
      setStatus(`Stopped watching ${activeDomain}`, 'muted');
    }
    await saveStorage({ trackedDomains: domains });
    await renderDomainList(activeDomain);
  });

  // Sync Now button
  document.getElementById('syncBtn').addEventListener('click', async () => {
    if (!activeDomain) return;
    const btn = document.getElementById('syncBtn');
    const iconEl = document.getElementById('syncBtnIcon');
    const textEl = document.getElementById('syncBtnText');
    btn.disabled = true;
    iconEl.textContent = '…';
    textEl.textContent = 'Syncing…';
    setStatus(`Reading cookies for ${activeDomain}…`, 'muted');

    const result = await chrome.runtime.sendMessage({ type: 'SYNC_DOMAIN', domain: activeDomain, forced: true });

    btn.disabled = false;
    iconEl.textContent = '↑';
    textEl.textContent = 'Sync Now';

    if (result.success) {
      setStatus(`✓ ${result.count} cookies synced to "${result.label}"`, 'ok');
    } else if (result.skipped) {
      const reasonMap = {
        no_api_key: '✗ No API key — open Settings',
        no_tab: 'No open tab — keep the site open in another tab',
        no_cookies: 'No readable cookies found',
        unchanged: 'No changes since last sync',
      };
      setStatus(reasonMap[result.reason] || result.reason, result.reason === 'no_api_key' ? 'err' : 'muted');
    } else {
      setStatus(`✗ ${result.error}`, 'err');
    }

    await renderDomainList(activeDomain);
  });

  // Sync All button
  document.getElementById('syncAllBtn').addEventListener('click', async () => {
    const btn = document.getElementById('syncAllBtn');
    btn.disabled = true;
    btn.textContent = '…';
    setStatus('Syncing all watched sites…', 'muted');
    await chrome.runtime.sendMessage({ type: 'SYNC_ALL' });
    btn.disabled = false;
    btn.textContent = '↑ Sync All';
    setStatus('All sites synced', 'ok');
    await renderDomainList(activeDomain);
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
});
