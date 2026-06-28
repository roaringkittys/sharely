/* sharely-extension.js for Sharely Extension 1.1 */

// ── DEFAULT SERVER URL ─────────────────────────────────────────────────────
// Set this to your deployed server URL before distributing the extension.
// Users will never need to configure this manually.
const DEFAULT_SERVER_URL = 'https://your-railway-domain.up.railway.app';
// ──────────────────────────────────────────────────────────────────────────

let allServices = [];
let currentCategory = 'all';
let serverUrl = '';
let apiKey = '';
let currentUserSession = '';
let currentUserEmail = '';
let currentUserExpiry = '';

async function loadStorage() {
  return new Promise(resolve => {
    chrome.storage.local.get(['serverUrl', 'apiKey', 'theme', 'userSession', 'userEmail', 'userExpiry'], resolve);
  });
}

async function saveStorage(data) {
  return new Promise(resolve => chrome.storage.local.set(data, resolve));
}

// ── Device fingerprint ────────────────────────────────────────────────────

function getDeviceFingerprint() {
  const raw = [
    navigator.userAgent,
    navigator.language,
    screen.width + 'x' + screen.height,
    new Date().getTimezoneOffset(),
    navigator.hardwareConcurrency || 0,
    navigator.platform || '',
  ].join('|');
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) - hash) + raw.charCodeAt(i);
    hash |= 0;
  }
  return 'ext_' + Math.abs(hash).toString(16).padStart(8, '0');
}

// ── Auth overlay ──────────────────────────────────────────────────────────

function showAuthScreen(error) {
  $('#authSuccess').hide();
  $('#authForm').show();
  $('#authSubmitBtn').prop('disabled', false).text('Continue');
  if (error) {
    $('#authError').text(error).show();
  } else {
    $('#authError').hide();
  }
  $('#authOverlay').css('display', 'flex').hide().fadeIn(200);
}

function hideAuthScreen() {
  $('#authOverlay').fadeOut(250);
}

function updateUserFooter(email, expiresAt) {
  if (!email) { $('#footer').text('Sharely \u00a9 2024\u20132025'); return; }
  const days = Math.max(0, Math.ceil((new Date(expiresAt) - new Date()) / (1000 * 60 * 60 * 24)));
  const short = email.length > 20 ? email.substring(0, 17) + '\u2026' : email;
  let badge;
  if (days <= 0) badge = '<span class="expiry-badge expiry-expired">Expired</span>';
  else if (days <= 7) badge = `<span class="expiry-badge expiry-soon">${days}d left</span>`;
  else badge = `<span class="expiry-badge expiry-ok">${days}d left</span>`;
  $('#footer').html(`${short}&nbsp;${badge}`);
}

async function doExtensionLogin(email, token) {
  const fingerprint = getDeviceFingerprint();
  const body = { email: email.trim().toLowerCase(), deviceFingerprint: fingerprint };
  if (token && token.trim()) body.token = token.trim();
  const res = await fetch(`${serverUrl}/auth/extension-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, data: await res.json() };
}

async function verifyStoredSession(session) {
  const res = await fetch(`${serverUrl}/auth/extension-verify`, {
    headers: { 'X-User-Session': session },
  });
  if (!res.ok) return null;
  return await res.json();
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
    const subServices = service.sub_services || [];
    const hasSubServices = subServices.length > 0;
    const hasAccounts = accounts.length > 0;
    const accountCount = accounts.length;

    // Badge: sub-service count (purple) takes priority over account count
    let badge = '';
    if (hasSubServices) {
      badge = `<span class="account-badge" style="background:linear-gradient(135deg,#6c5ce7,#a29bfe)">${subServices.length}</span>`;
    } else if (accountCount > 1) {
      badge = `<span class="account-badge">${accountCount}</span>`;
    }

    const $item = $(`
      <div class="col-2 text-center service" data-category="${service.category}" data-id="${service.id}">
        <div style="position:relative;display:inline-block">
          ${buildServiceIcon(service)}
          ${!hasSubServices && !hasAccounts ? '<span class="overlay">–</span>' : ''}
          ${badge}
        </div>
        <p class="menu-text">${service.name}</p>
      </div>
    `);

    $item.on('click', function () {
      if (hasSubServices) {
        showSubServicesView(service);
        return;
      }
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

// ── Sub-services view ─────────────────────────────────────────────────────

function showSubServicesView(parentService) {
  const subServices = parentService.sub_services || [];
  const $sub = $('#subView').empty();

  if (subServices.length === 0) {
    $sub.html(`<div class="col-12 mt-4"><p style="color:#aaa;font-size:13px">No sub-services configured.</p></div>`);
  } else {
    subServices.forEach(service => {
      const accounts = service.accounts || [];
      const hasAccounts = accounts.length > 0;
      const accountCount = accounts.length;
      const badge = accountCount > 1 ? `<span class="account-badge">${accountCount}</span>` : '';

      const $item = $(`
        <div class="col-2 text-center service" data-id="${service.id}">
          <div style="position:relative;display:inline-block">
            ${buildServiceIcon(service)}
            ${!hasAccounts ? '<span class="overlay">–</span>' : ''}
            ${badge}
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

      $sub.append($item);
    });
  }

  // Switch header to sub-view mode
  $('#mainViewHeader').css('display', 'none');
  $('#subViewHeader').css('display', 'flex');
  $('#subViewTitle').text(parentService.name);
  $('#filtersToggleRow').hide();
  $('#categoryFiltersContainer').hide();

  // Switch content
  $('#loaded').addClass('d-none');
  $('#subView').removeClass('d-none');
}

function closeSubServicesView() {
  $('#subView').addClass('d-none');
  $('#subViewHeader').css('display', 'none');
  $('#mainViewHeader').css('display', 'contents');
  $('#filtersToggleRow').show();
  const filtersHidden = $('#categoryFiltersContainer').hasClass('hidden');
  if (!filtersHidden) $('#categoryFiltersContainer').show();
  $('#loaded').removeClass('d-none');
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
  currentUserSession = stored.userSession || '';

  if (!serverUrl) {
    showError('Configure your server URL in settings first.');
    disableFilters();
    return;
  }

  if (!currentUserSession && !apiKey) {
    showAuthScreen();
    return;
  }

  showLoading();

  try {
    const headers = { 'Accept': 'application/json' };
    if (currentUserSession) {
      headers['X-User-Session'] = currentUserSession;
    } else {
      headers['X-API-Key'] = apiKey;
    }

    const res = await fetch(`${serverUrl}/api/extension/config`, {
      method: 'GET',
      headers,
    });

    if (res.status === 401) {
      await saveStorage({ userSession: '', userEmail: '', userExpiry: '' });
      currentUserSession = '';
      showAuthScreen('Your session expired. Please log in again.');
      disableFilters();
      return;
    }

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

// Back button — exit sub-services view
$('#backBtn').on('click', closeSubServicesView);

// Refresh — also close sub-view if open
$('#refreshButton').on('click', () => {
  if ($('#subView').is(':visible')) closeSubServicesView();
  fetchConfig();
});

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

  // Populate developer fields (hidden by default)
  $('#settingServerUrl').val(stored.serverUrl || serverUrl || '');
  $('#settingApiKey').val(stored.apiKey || '');
  $('#settingsStatus').text('');
  $('#devSection').hide();
  $('#devChevron').css('transform', '');

  // Show account info if logged in
  if (currentUserEmail && currentUserExpiry) {
    const days = Math.max(0, Math.ceil((new Date(currentUserExpiry) - new Date()) / 86400000));
    $('#settingsEmail').text(currentUserEmail);
    $('#settingsExpiry').text(days > 0 ? `Access valid for ${days} more day${days !== 1 ? 's' : ''}` : 'Access expired');
    $('#settingsAccountInfo').show();
    $('#signOutBtn').show();
    $('#settingsNotLoggedIn').hide();
  } else {
    $('#settingsAccountInfo').hide();
    $('#signOutBtn').hide();
    $('#settingsNotLoggedIn').show();
  }

  $('#settingsOverlay').show();
});

$('#closeSettings').on('click', () => $('#settingsOverlay').hide());

// Developer section toggle
$('#devToggle').on('click', () => {
  const $sec = $('#devSection');
  const open = $sec.is(':visible');
  $sec.slideToggle(150);
  $('#devChevron').css('transform', open ? '' : 'rotate(180deg)');
});

// Sign out from Settings
$('#signOutBtn').on('click', async () => {
  if (!confirm('Sign out of your Sharely account?')) return;
  await saveStorage({ userSession: '', userEmail: '', userExpiry: '' });
  currentUserSession = '';
  currentUserEmail = '';
  currentUserExpiry = '';
  $('#footer').text('Sharely \u00a9 2024\u20132025');
  $('#settingsOverlay').hide();
  showAuthScreen();
});

// Login link from Settings (for non-logged-in users)
$('#settingsLoginLink').on('click', (e) => {
  e.preventDefault();
  $('#settingsOverlay').hide();
  showAuthScreen();
});

$('#saveSettingsBtn').on('click', async () => {
  const url = ($('#settingServerUrl').val() || '').trim().replace(/\/+$/, '');
  const key = ($('#settingApiKey').val() || '').trim();

  if (!url) {
    $('#settingsStatus').css('color', '#e74c3c').text('Server URL is required.');
    return;
  }

  $('#settingsStatus').css('color', '#aaa').text('Testing connection...');

  try {
    const headers = {};
    if (key) headers['X-API-Key'] = key;
    else if (currentUserSession) headers['X-User-Session'] = currentUserSession;

    const res = await fetch(`${url}/api/extension/config`, { headers });

    if (!res.ok) throw new Error('Could not connect — check URL and key');

    await saveStorage({ serverUrl: url, apiKey: key || '' });
    serverUrl = url;
    apiKey = key || '';
    $('#settingsStatus').css('color', '#2ecc71').text('Connected!');
    setTimeout(() => {
      $('#settingsOverlay').hide();
      fetchConfig();
    }, 700);

  } catch (err) {
    $('#settingsStatus').css('color', '#e74c3c').text('Failed: ' + err.message);
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

// ── Auth event handlers ───────────────────────────────────────────────────

$('#authHelpLink').on('click', async (e) => {
  e.preventDefault();
  const stored = await loadStorage();
  const base = (stored.serverUrl || '').replace(/\/+$/, '');
  chrome.tabs.create({ url: base ? `${base}/start` : 'https://sharely.app/start' });
});

$('#authSubmitBtn').on('click', async () => {
  const email = $('#authEmail').val().trim();
  const token = $('#authToken').val().trim();

  if (!email) {
    $('#authError').text('Please enter your email address.').show();
    return;
  }
  if (!serverUrl) {
    const stored = await loadStorage();
    serverUrl = (stored.serverUrl || '').replace(/\/+$/, '');
  }
  if (!serverUrl) {
    $('#authError').text('Server URL not set. Open Settings and paste your server URL.').show();
    return;
  }

  $('#authError').hide();
  $('#authSubmitBtn').prop('disabled', true).text('Connecting...');

  try {
    // Smart: pass token only if provided; backend handles both register and login
    const { ok, data } = await doExtensionLogin(email, token || null);

    if (!ok || !data.success) {
      const errMsg = data.error || 'Login failed. Please try again.';
      // If no account found and no token was entered, guide them to enter token
      if (!token && (errMsg.toLowerCase().includes('no account') || errMsg.toLowerCase().includes('not found') || errMsg.toLowerCase().includes('invalid token'))) {
        $('#authError').text('No account found for this email. Paste your access token below to register.').show();
        $('#authToken').focus();
      } else {
        $('#authError').text(errMsg).show();
      }
      $('#authSubmitBtn').prop('disabled', false).text('Continue');
      return;
    }

    // Save session
    await saveStorage({
      userSession: data.session_token,
      userEmail: data.email,
      userExpiry: data.access_expires_at,
    });
    currentUserSession = data.session_token;
    currentUserEmail = data.email;
    currentUserExpiry = data.access_expires_at;

    // Show success state
    const days = data.days_remaining;
    $('#authForm').hide();
    $('#authSuccessTitle').text(data.is_new_user ? `Welcome, ${data.email.split('@')[0]}!` : 'Welcome back!');
    $('#authSuccessMsg').text(`Access valid for ${days} more day${days !== 1 ? 's' : ''}. Loading your services...`);
    $('#authSuccess').fadeIn(300);

    updateUserFooter(data.email, data.access_expires_at);

    setTimeout(() => {
      hideAuthScreen();
      fetchConfig();
    }, 1800);

  } catch (err) {
    $('#authSubmitBtn').prop('disabled', false).text('Continue');
    $('#authError').text('Connection failed. Check your server URL in Settings.').show();
  }
});

// Allow Enter key to submit auth form
$('#authEmail, #authToken').on('keydown', (e) => {
  if (e.key === 'Enter') $('#authSubmitBtn').click();
});

// ── User account sign-out ─────────────────────────────────────────────────
// (clicking the footer email/badge signs out of the user account)
$('#footer').on('click', '.expiry-badge, .user-email-text', async () => {
  if (!currentUserSession) return;
  if (!confirm('Sign out of your Sharely account?')) return;
  await saveStorage({ userSession: '', userEmail: '', userExpiry: '' });
  currentUserSession = '';
  currentUserEmail = '';
  currentUserExpiry = '';
  $('#footer').text('Sharely \u00a9 2024\u20132025');
  showAuthScreen();
});

// Initialise
$(async () => {
  const stored = await loadStorage();

  // Auto-apply default server URL if none stored — users never need to configure this
  if (!stored.serverUrl && DEFAULT_SERVER_URL) {
    await saveStorage({ serverUrl: DEFAULT_SERVER_URL });
    serverUrl = DEFAULT_SERVER_URL;
  } else {
    serverUrl = (stored.serverUrl || '').replace(/\/+$/, '');
  }

  if (stored.theme) applyTheme(stored.theme);

  // If we have a stored session, restore footer display immediately
  if (stored.userEmail && stored.userExpiry) {
    updateUserFooter(stored.userEmail, stored.userExpiry);
  }

  const userSession = stored.userSession || '';

  // If no credentials at all, show auth
  if (!userSession && !stored.apiKey) {
    showAuthScreen();
    return;
  }

  // Should not happen with DEFAULT_SERVER_URL, but guard anyway
  if (!serverUrl) {
    showError('Server not configured. Contact support.');
    disableFilters();
    return;
  }

  // If we have a user session, verify it's still valid
  if (userSession) {
    try {
      const result = await verifyStoredSession(userSession);
      if (!result || !result.valid) {
        await saveStorage({ userSession: '', userEmail: '', userExpiry: '' });
        showAuthScreen(result ? result.error : 'Session expired. Please log in again.');
        return;
      }
      currentUserSession = userSession;
      currentUserEmail = result.user.email;
      currentUserExpiry = result.user.access_expires_at;
      updateUserFooter(currentUserEmail, currentUserExpiry);
    } catch (_) {
      // Network error — try loading anyway, fetchConfig will handle 401
    }
  }

  fetchConfig();
});
