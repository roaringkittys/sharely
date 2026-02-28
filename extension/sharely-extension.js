/* sharely-extension.js for Sharely Extension 1.1 */

let allServices = [];
let currentCategory = 'all';
let serverUrl = '';
let apiKey = '';

async function loadStorage() {
  return new Promise(resolve => {
    chrome.storage.local.get(['serverUrl', 'apiKey', 'theme'], resolve);
  });
}

async function saveStorage(data) {
  return new Promise(resolve => chrome.storage.local.set(data, resolve));
}

function showLoading() {
  $('#loading').removeClass('d-none');
  $('#loaded').addClass('d-none');
  $('#errored').addClass('d-none');
}

function showLoaded() {
  $('#loading').addClass('d-none');
  $('#loaded').removeClass('d-none');
  $('#errored').addClass('d-none');
}

function showError(msg) {
  $('#loading').addClass('d-none');
  $('#loaded').addClass('d-none');
  $('#errored').removeClass('d-none');
  if (msg) $('#errorMsg').text(msg);
}

function enableFilters() {
  $('.category-filter').prop('disabled', false);
  $('#appSearch').prop('disabled', false).attr('placeholder', 'Search services...');
}

function disableFilters() {
  $('.category-filter').prop('disabled', true);
  $('#appSearch').prop('disabled', true).attr('placeholder', 'Connecting...');
}

// Renders a service icon — PNG if icon_url set, else emoji
function buildServiceIcon(service) {
  if (service.icon_url) {
    return `<div class="service-img-icon"><img src="${serverUrl}${service.icon_url}" alt="${service.name}" onerror="this.parentElement.innerHTML='<span style=\\'font-size:28px\\'>${service.icon || '🌐'}</span>'"></div>`;
  }
  if (service.icon && service.icon.length <= 4) {
    return `<div class="service-emoji-icon">${service.icon}</div>`;
  }
  return `<div class="service-emoji-icon">🌐</div>`;
}

function renderServices(services) {
  const $menu = $('#loaded');
  $menu.empty();

  if (services.length === 0) {
    $menu.html(`<div class="col-12 mt-4"><p style="color:#aaa;font-size:13px">No services found.</p></div>`);
    showLoaded();
    return;
  }

  services.forEach(service => {
    const accounts = service.accounts || [];
    const hasAccounts = accounts.length > 0;
    const accountCount = accounts.length;

    const $item = $(`
      <div class="col-3 text-center service" data-category="${service.category}" data-id="${service.id}">
        <div style="position:relative;display:inline-block">
          ${buildServiceIcon(service)}
          ${!hasAccounts ? '<span class="overlay">–</span>' : ''}
          ${accountCount > 1 ? `<span class="account-badge">${accountCount}</span>` : ''}
        </div>
        <p class="menu-text">${service.name}</p>
      </div>
    `);

    $item.on('click', function () {
      if (!hasAccounts) {
        showNotification('No accounts', `${service.name} has no cookies configured yet.`);
        return;
      }
      if (accountCount === 1) {
        doInject(service, accounts[0]);
      } else {
        showAccountPicker(service, accounts);
      }
    });

    $menu.append($item);
  });

  showLoaded();
  enableFilters();
}

function filterAndRender() {
  const query = $('#appSearch').val().toLowerCase();
  let filtered = allServices;

  if (currentCategory !== 'all') {
    filtered = filtered.filter(s => s.category === currentCategory);
  }

  if (query) {
    filtered = filtered.filter(s =>
      s.name.toLowerCase().includes(query) ||
      s.domain.toLowerCase().includes(query)
    );
  }

  renderServices(filtered);
}

// Account picker overlay
function showAccountPicker(service, accounts) {
  const iconHtml = service.icon_url
    ? `<img src="${serverUrl}${service.icon_url}" style="width:36px;height:36px;border-radius:8px;object-fit:cover" onerror="this.outerHTML='<span style=\\'font-size:28px\\'>${service.icon || '🌐'}</span>'">`
    : `<span style="font-size:28px">${service.icon || '🌐'}</span>`;

  const accountButtons = accounts.map((acc, i) => `
    <button class="account-pick-btn" data-idx="${i}">
      <span class="account-pick-label">${acc.label}</span>
      <span class="account-pick-count">${acc.cookies.length} cookie${acc.cookies.length !== 1 ? 's' : ''}</span>
    </button>
  `).join('');

  $('#accountPickerTitle').html(`${iconHtml} <span>${service.name}</span>`);
  $('#accountPickerList').html(accountButtons);
  $('#accountPickerOverlay').css('display', 'flex').hide().fadeIn(150);

  // Bind account buttons
  $('#accountPickerList').off('click', '.account-pick-btn').on('click', '.account-pick-btn', function () {
    const idx = parseInt($(this).data('idx'));
    closeAccountPicker();
    doInject(service, accounts[idx]);
  });
}

function closeAccountPicker() {
  $('#accountPickerOverlay').fadeOut(120);
}

// Core injection
function doInject(service, account) {
  showNotification(
    'Injecting...',
    `Setting up "${account.label}" for ${service.name} (${account.cookies.length} cookies)...`
  );

  const targetUrl = `https://${service.domain.replace(/^\./, '')}`;

  chrome.runtime.sendMessage(
    { type: 'INJECT_AND_OPEN', cookies: account.cookies, targetUrl },
    (response) => {
      if (chrome.runtime.lastError) {
        closeNotification();
        showNotification('Error', 'Background error: ' + chrome.runtime.lastError.message);
        return;
      }

      if (response && response.success) {
        const { results } = response;
        const ok = results.success.length;
        const bad = results.failed.length;
        const total = ok + bad;

        if (bad === 0) {
          showNotification('✅ Done!', `${ok}/${total} cookies set. Opening ${service.name}...`);
        } else {
          const failMsg = results.failed.map(f => `${f.name}: ${f.reason}`).join('\n');
          showNotification(`⚠️ Partial (${ok}/${total})`, `Some cookies failed:\n${failMsg}`);
        }
        setTimeout(closeNotification, 3500);
      } else {
        closeNotification();
        showNotification('Error', 'Inject failed: ' + ((response && response.error) || 'Unknown'));
      }
    }
  );
}

async function clearAllCookies() {
  if (!confirm('Clear all session cookies from Sharely services?')) return;

  const domains = allServices.map(s => s.domain.replace(/^\./, ''));

  chrome.runtime.sendMessage({ type: 'CLEAR_ALL', domains }, (response) => {
    if (response && response.success) {
      showNotification('Logged Out', `Cleared ${response.cleared} cookies from all services.`);
    } else {
      showNotification('Logged Out', 'Cookies cleared.');
    }
    setTimeout(closeNotification, 2000);
  });
}

function showNotification(title, message) {
  const $modal = $('#notification-0');
  const safeMsg = String(message)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
  $modal.find('.notificationModal-content').html(`
    <i class="fas fa-times close-icon" id="closeNotif"></i>
    <h2>${title}</h2>
    <p style="text-align:left;font-size:11px;line-height:1.6">${safeMsg}</p>
  `);
  $modal.css({ display: 'flex', opacity: 1, visibility: 'visible' });
  $('#closeNotif').on('click', closeNotification);
}

function closeNotification() {
  $('#notification-0').css({ opacity: 0, visibility: 'hidden' });
}

async function fetchConfig() {
  const stored = await loadStorage();
  serverUrl = (stored.serverUrl || '').replace(/\/+$/, '');
  apiKey = stored.apiKey || '';

  if (!serverUrl || !apiKey) {
    showError('Configure your server URL and API key to connect.');
    disableFilters();
    return;
  }

  showLoading();

  try {
    const res = await fetch(`${serverUrl}/api/extension/config`, {
      method: 'GET',
      headers: { 'X-API-Key': apiKey, 'Accept': 'application/json' }
    });

    if (!res.ok) throw new Error(`Server responded with status ${res.status}`);

    const data = await res.json();
    allServices = data.services || [];
    currentCategory = 'all';
    $('.category-filter').removeClass('active');
    $('#all-category').addClass('active');
    filterAndRender();

    if (data.theme) applyTheme(data.theme);

  } catch (err) {
    showError('Cannot connect to Sharely server. Check your settings.');
    disableFilters();
    console.error('Sharely fetch error:', err);
  }
}

function applyTheme(theme) {
  if (theme === 'light') {
    $('body').addClass('light-theme');
    $('#theme-light').removeClass('d-none');
    $('#theme-dark').addClass('d-none');
  } else {
    $('body').removeClass('light-theme');
    $('#theme-dark').removeClass('d-none');
    $('#theme-light').addClass('d-none');
  }
  saveStorage({ theme });
}

// Category filter
$(document).on('click', '.category-filter:not([disabled])', function () {
  $('.category-filter').removeClass('active');
  $(this).addClass('active');
  currentCategory = $(this).data('category');
  filterAndRender();
});

// Search
$('#appSearch').on('input', filterAndRender);

// Toggle category filters
$('#toggleFilters').on('click', function () {
  $(this).toggleClass('rotated');
  $('#categoryFiltersContainer').toggleClass('hidden');
});

// Refresh
$('#refreshButton').on('click', fetchConfig);

// Safe logout
$('#safeLogout').on('click', clearAllCookies);

// Theme toggles
$('#theme-light').on('click', () => applyTheme('dark'));
$('#theme-dark').on('click', () => applyTheme('light'));

// Account picker close
$('#accountPickerClose, #accountPickerOverlay').on('click', closeAccountPicker);
$('#accountPicker').on('click', function (e) { e.stopPropagation(); });

// Settings
$('#settingsButton, #openSettingsFromError').on('click', async () => {
  const stored = await loadStorage();
  $('#settingServerUrl').val(stored.serverUrl || '');
  $('#settingApiKey').val(stored.apiKey || '');
  $('#settingsStatus').text('');
  $('#settingsOverlay').show();
});

$('#closeSettings').on('click', () => $('#settingsOverlay').hide());

$('#saveSettingsBtn').on('click', async () => {
  const url = $('#settingServerUrl').val().trim().replace(/\/+$/, '');
  const key = $('#settingApiKey').val().trim();

  if (!url || !key) {
    $('#settingsStatus').css('color', '#e74c3c').text('Both fields are required.');
    return;
  }

  $('#settingsStatus').css('color', '#aaa').text('Testing connection...');

  try {
    const res = await fetch(`${url}/api/extension/config`, {
      headers: { 'X-API-Key': key }
    });

    if (!res.ok) throw new Error('Invalid API key or server URL');

    await saveStorage({ serverUrl: url, apiKey: key });
    $('#settingsStatus').css('color', '#2ecc71').text('Connected successfully!');
    setTimeout(() => {
      $('#settingsOverlay').hide();
      fetchConfig();
    }, 800);

  } catch (err) {
    $('#settingsStatus').css('color', '#e74c3c').text('Connection failed: ' + err.message);
  }
});

// ── One-Click Capture ─────────────────────────────────────────────────
let capturedCookiesCache = [];
let capturedDomainCache = '';

function closeCaptureOverlay() {
  $('#captureOverlay').fadeOut(150);
}

$('#captureButton').on('click', () => {
  if (!serverUrl || !apiKey) {
    showNotification('Not connected', 'Set your server URL and API key in settings first.');
    setTimeout(closeNotification, 2500);
    return;
  }

  // Reset state
  capturedCookiesCache = [];
  capturedDomainCache = '';
  $('#captureScanning').show();
  $('#captureReady').hide();
  $('#captureError').hide();
  $('#captureLabelInput').val('');
  $('#captureOverlay').css('display', 'flex').hide().fadeIn(150);

  // Ask background to get cookies from the active tab
  chrome.runtime.sendMessage({ type: 'GET_SITE_COOKIES' }, (response) => {
    if (chrome.runtime.lastError || !response || !response.success) {
      const err = (response && response.error) || 'Could not read tab cookies.';
      $('#captureScanning').hide();
      $('#captureError').show();
      $('#captureErrorMsg').text(err);
      return;
    }

    const { hostname, rootDomain, tabTitle, cookies } = response;
    capturedCookiesCache = cookies;
    capturedDomainCache = rootDomain;

    if (cookies.length === 0) {
      $('#captureScanning').hide();
      $('#captureError').show();
      $('#captureErrorMsg').text(`No cookies found on ${hostname}. Make sure you are logged in.`);
      return;
    }

    // Show the confirm UI
    $('#captureSiteInfo').html(`
      <div>
        <div class="capture-site-domain">${hostname}</div>
        <div class="capture-site-tab">${tabTitle}</div>
      </div>
    `);
    $('#captureCookieCount').text(cookies.length);
    $('#captureScanning').hide();
    $('#captureReady').show();
  });
});

$('#captureClose').on('click', closeCaptureOverlay);
$('#captureOverlay').on('click', function (e) {
  if (e.target === this) closeCaptureOverlay();
});

$('#captureConfirmBtn').on('click', async () => {
  if (!capturedCookiesCache.length) return;

  const label = $('#captureLabelInput').val().trim() || undefined;

  $('#captureConfirmBtn').prop('disabled', true).text('Sending...');

  try {
    const payload = {
      domain: capturedDomainCache,
      cookies: capturedCookiesCache.map(c => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        secure: c.secure,
        httpOnly: c.httpOnly,
        expirationDate: c.expirationDate,
      })),
      label,
    };

    const res = await fetch(`${serverUrl}/api/capture`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (data.success) {
      closeCaptureOverlay();
      showNotification(
        '✅ Captured!',
        `${data.count} cookies saved to "${data.service_name}" as "${data.label}". Refreshing...`
      );
      setTimeout(() => {
        closeNotification();
        fetchConfig();
      }, 2000);
    } else {
      throw new Error(data.error || 'Unknown server error');
    }

  } catch (err) {
    $('#captureConfirmBtn').prop('disabled', false).html('<i class="fas fa-upload" style="margin-right:6px"></i>Send to Dashboard');
    $('#captureReady').hide();
    $('#captureError').show();
    $('#captureErrorMsg').text('Failed: ' + err.message);
  }
});
// ─────────────────────────────────────────────────────────────────────

// Admin dashboard
$('#adminButton').on('click', async () => {
  const stored = await loadStorage();
  if (stored.serverUrl) {
    chrome.tabs.create({ url: stored.serverUrl });
  } else {
    showNotification('Not configured', 'Set your server URL in settings first.');
    setTimeout(closeNotification, 2000);
  }
});

// Initialise
$(async () => {
  const stored = await loadStorage();
  if (stored.theme) applyTheme(stored.theme);
  fetchConfig();
});
