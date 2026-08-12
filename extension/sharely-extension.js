/* sharely-extension.js for Sharely Extension 1.2 */

let allServices = [];
let currentCategory = 'all';
let serverUrl = '';         // service server URL — cookies & services
let membershipUrl = '';     // membership server URL — auth, subscriptions, dashboard
let apiKey = '';
let memberAccessToken = ''; // member access_token used as X-API-Key for Railway service calls
let currentMemberEmail = '';
let currentMemberExpiry = '';
let currentMemberName = '';
let currentMemberPlan = '';

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

async function loadStorage() {
  return new Promise(resolve => {
    chrome.storage.local.get(['serverUrl', 'membershipUrl', 'apiKey', 'memberAccessToken', 'memberSessionToken', 'theme'], resolve);
  });
}

async function saveStorage(data) {
  return new Promise(resolve => chrome.storage.local.set(data, resolve));
}

// ── Logged-out state ──────────────────────────────────────────────────────

function showLoggedOut(message) {
  $('#loading').addClass('d-none');
  $('#loaded').addClass('d-none');
  $('#errored').addClass('d-none');
  $('#loggedOutState').removeClass('d-none');
  $('#loggedOutTitle').text('Log in to Sharely');
  $('#loggedOutMsg').text(message || 'Use your member account or an extension token to load services.');
  $('#extensionLoginForm').show();
  $('#subscriptionInactive').hide();
  disableFilters();
}

function showSubscriptionInactive(message, email, expiresAt) {
  $('#loading').addClass('d-none');
  $('#loaded').addClass('d-none');
  $('#errored').addClass('d-none');
  $('#loggedOutState').removeClass('d-none');
  $('#loggedOutTitle').text('Membership required');
  $('#loggedOutMsg').text(message || 'Your account is logged in, but it does not have an active membership.');
  $('#extensionLoginForm').hide();
  $('#subscriptionInactive').show();
  disableFilters();
  memberAccessToken = '';
  saveStorage({ memberAccessToken: '' });
  if (email) {
    currentMemberEmail = email;
    currentMemberExpiry = expiresAt || '';
    updateMemberFooter(email, expiresAt || new Date().toISOString());
  }
}

function updateMemberFooter(email, expiresAt) {
  if (!email) { $('#footer').text('Sharely \u00a9 2024\u20132025'); return; }
  const days = Math.max(0, Math.ceil((new Date(expiresAt) - new Date()) / (1000 * 60 * 60 * 24)));
  const short = email.length > 22 ? email.substring(0, 19) + '\u2026' : email;
  let badge;
  if (days <= 0) badge = '<span class="expiry-badge expiry-expired">Expired</span>';
  else if (days <= 7) badge = `<span class="expiry-badge expiry-soon">${days}d left</span>`;
  else badge = `<span class="expiry-badge expiry-ok">${days}d left</span>`;
  $('#footer').html(`${short}&nbsp;${badge}`);
}

function updateMemberStrip(name, plan, expiresAt) {
  if (!name && !plan) { $('#memberStrip').addClass('d-none'); return; }
  const days = Math.max(0, Math.ceil((new Date(expiresAt) - new Date()) / (1000 * 60 * 60 * 24)));
  const displayName = name || '';
  const displayPlan = plan || '';
  const dayStr = days > 0 ? `${days}d left` : 'Expired';
  $('#memberStripText').text(`${displayName}${displayPlan ? ' · ' + displayPlan : ''} · ${dayStr}`);
  $('#memberStrip').removeClass('d-none');
}

// ── Session check with chrome.storage.session caching ─────────────────────

async function checkSession() {
  if (!membershipUrl) return null;
  try {
    // Normal Chrome sends credentials:include here. Orion may not, so obtain
    // the existing Replit session cookie through the background cookie API.
    let sessionHeaders = {};
    try {
      const cookieResult = await new Promise(resolve => {
        chrome.runtime.sendMessage(
          { type: 'GET_MEMBERSHIP_SESSION_COOKIE', membershipUrl },
          resolve
        );
      });
      if (cookieResult && cookieResult.success && cookieResult.cookie) {
        sessionHeaders['X-Sharely-Session'] = cookieResult.cookie;
      }
    } catch (_) {}
    const stored = await loadStorage();
    if (!sessionHeaders['X-Sharely-Session'] && stored.memberAccessToken) {
      sessionHeaders['X-Extension-Token'] = stored.memberAccessToken;
    }

    const res = await fetch(`${membershipUrl}/api/membership/extension-session`, {
      credentials: 'include',
      headers: sessionHeaders,
    });
    if (!res.ok) return { authenticated: false };
    const data = await res.json();
    // Cache result in chrome.storage.session (auto-cleared when browser closes)
    if (chrome.storage.session) {
      await new Promise(r => chrome.storage.session.set({ memberSession: data }, r));
    }
    return data;
  } catch (e) {
    return { networkError: true };
  }
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

// Account picker overlay — icon card grid like screenshots
function showAccountPicker(service, accounts) {
  const iconHtml = service.icon_url
    ? `<img src="${serverUrl}${service.icon_url}" style="width:36px;height:36px;border-radius:8px;object-fit:cover" onerror="this.outerHTML='<span style=\\'font-size:28px\\'>${service.icon || '🌐'}</span>'">`
    : `<span style="font-size:28px">${service.icon || '🌐'}</span>`;

  // Reuse the service icon for every account card
  const pickIcon = (acc) => {
    if (service.icon_url) {
      return `<div class="pick-icon"><img src="${serverUrl}${service.icon_url}" alt="" onerror="this.parentElement.innerHTML='<span style=font-size:28px>${service.icon || '🌐'}</span>'"></div>`;
    }
    if (service.icon && service.icon.length <= 4) {
      return `<div class="pick-icon">${service.icon}</div>`;
    }
    return `<div class="pick-icon">🌐</div>`;
  };

  const cards = accounts.map((acc, i) => `
    <div class="account-pick-card" data-idx="${i}">
      ${pickIcon(acc)}
      <div class="pick-label">${escapeHtml(acc.label)}</div>
    </div>
  `).join('');

  $('#accountPickerTitle').html(`${iconHtml} <span>${escapeHtml(service.name)}</span>`);
  $('#accountPickerList').html(cards);
  $('#accountPickerOverlay').css('display', 'flex').hide().fadeIn(150);

  // Bind card clicks
  $('#accountPickerList').off('click', '.account-pick-card').on('click', '.account-pick-card', function () {
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
  membershipUrl = (stored.membershipUrl || '').replace(/\/+$/, '');
  apiKey = stored.apiKey || '';

  if (!serverUrl) {
    showError('Configure your server URL in settings first.');
    disableFilters();
    return;
  }

  showLoading();

  try {
    // Try membership session first (Replit, via cookies) — active members get an access_token
    const sessionData = await checkSession();

    if (sessionData && sessionData.networkError) {
      showError('Network error. Check your connection and try again.');
      disableFilters();
      return;
    }

    if (sessionData) {
      if (sessionData.authenticated && sessionData.subscription && sessionData.subscription.active) {
        currentMemberEmail = sessionData.user.email;
        currentMemberName = sessionData.user.name || '';
        currentMemberExpiry = sessionData.subscription.expires_at;
        currentMemberPlan = sessionData.subscription.plan || '';
        memberAccessToken = sessionData.user.access_token || '';
        if (memberAccessToken) await saveStorage({ memberAccessToken });
        updateMemberFooter(currentMemberEmail, currentMemberExpiry);
        updateMemberStrip(currentMemberName, currentMemberPlan, currentMemberExpiry);

        // Only an active member token may load services. The admin API key
        // is intentionally never used as the member login fallback.
        const configHeaders = memberAccessToken ? { 'X-API-Key': memberAccessToken } : {};
        const configRes = await fetch(`${serverUrl}/api/extension/config`, { headers: configHeaders });

        if (configRes.ok) {
          const data = await configRes.json();
          allServices = data.services || [];
          currentCategory = 'all';
          $('.category-filter').removeClass('active');
          $('#all-category').addClass('active');
          filterAndRender();
          if (data.theme) applyTheme(data.theme);
          return;
        }
        if (configRes.status === 401 || configRes.status === 403) {
          await saveStorage({ memberAccessToken: '' });
          memberAccessToken = '';
          showLoggedOut('Your login is no longer valid. Please log in again.');
          return;
        }
        throw new Error(`Service server responded with status ${configRes.status}`);
      } else if (sessionData.authenticated && sessionData.subscription && !sessionData.subscription.active) {
        showSubscriptionInactive(
          'Your Sharely subscription is expired or inactive. Renew your membership to unlock services.',
          sessionData.user && sessionData.user.email,
          sessionData.subscription && sessionData.subscription.expires_at
        );
        return;
      } else if (!sessionData.authenticated) {
        await saveStorage({ memberAccessToken: '' });
        memberAccessToken = '';
        showLoggedOut();
        return;
      }
    }

    showLoggedOut();

  } catch (err) {
    showError('Cannot connect to Sharely server. Check your settings.');
    disableFilters();
    console.error('Sharely fetch error:', err);
  }
}

async function loginExtension() {
  const email = ($('#extensionEmail').val() || '').trim();
  const password = $('#extensionPassword').val() || '';
  const token = ($('#extensionToken').val() || '').trim();
  const $button = $('#extensionLoginBtn');
  const $error = $('#extensionLoginError');

  $error.hide().text('');
  if (!token && (!email || !password)) {
    $error.text('Enter your email and password, or enter an extension token.').show();
    return;
  }
  if (!membershipUrl) {
    $error.text('Membership server is not configured. Open Settings to configure it.').show();
    return;
  }

  $button.prop('disabled', true).text('Logging in…');
  try {
    const res = await fetch(`${membershipUrl}/api/membership/extension-login`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, token }),
    });
    const data = await res.json().catch(() => ({}));

    if (res.status === 403 && data.code === 'SUBSCRIPTION_INACTIVE') {
      showSubscriptionInactive(
        data.error,
        data.user && data.user.email,
        data.subscription && data.subscription.expires_at
      );
      return;
    }
    if (!res.ok || !data.access_granted) {
      $error.text(data.error || 'Login failed. Check your details and try again.').show();
      return;
    }

    memberAccessToken = data.access_token || '';
    currentMemberEmail = data.user && data.user.email || email;
    currentMemberName = data.user && data.user.name || '';
    currentMemberExpiry = data.subscription && data.subscription.expires_at || '';
    currentMemberPlan = data.subscription && data.subscription.plan || '';
    await saveStorage({ memberAccessToken, memberSessionToken: data.session_token || '' });
    if (chrome.storage.session) {
      await new Promise(resolve => chrome.storage.session.set({
        memberSession: {
          authenticated: true,
          user: data.user,
          subscription: data.subscription,
        },
      }, resolve));
    }
    await fetchConfig();
  } catch (err) {
    $error.text('Network error. Check your connection and try again.').show();
  } finally {
    $button.prop('disabled', false).text('Log in');
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

  $('#settingServerUrl').val(stored.serverUrl || serverUrl || '');
  $('#settingMembershipUrl').val(stored.membershipUrl || membershipUrl || '');
  $('#settingApiKey').val(stored.apiKey || '');
  $('#settingsStatus').text('');
  $('#devSection').hide();
  $('#devChevron').css('transform', '');

  // Show account info if logged in via membership session
  if (currentMemberEmail && currentMemberExpiry) {
    const days = Math.max(0, Math.ceil((new Date(currentMemberExpiry) - new Date()) / 86400000));
    $('#settingsEmail').text(currentMemberEmail);
    $('#settingsExpiry').text(days > 0 ? `Subscription valid for ${days} more day${days !== 1 ? 's' : ''}` : 'Subscription expired');
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

// Login link from Settings (for non-logged-in users)
$('#settingsLoginLink').on('click', async (e) => {
  e.preventDefault();
  $('#settingsOverlay').hide();
  const url = membershipUrl ? `${membershipUrl}/membership/login` : 'https://sharely.app/membership/login';
  try { await chrome.tabs.create({ url }); } catch (_) { window.open(url, '_blank'); }
});

$('#extensionLoginBtn').on('click', loginExtension);
$('#extensionPassword, #extensionToken').on('keydown', (e) => {
  if (e.key === 'Enter') loginExtension();
});

$('#purchaseMembershipBtn').on('click', async () => {
  const url = membershipUrl
    ? `${membershipUrl}/membership/pricing`
    : 'https://sharely.app/membership/pricing';
  try { await chrome.tabs.create({ url }); } catch (_) { window.open(url, '_blank'); }
});

$('#signOutBtn').on('click', async () => {
  try {
    if (membershipUrl) {
      await fetch(`${membershipUrl}/api/membership/logout`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (_) {}
  memberAccessToken = '';
  currentMemberEmail = '';
  currentMemberExpiry = '';
  currentMemberName = '';
  currentMemberPlan = '';
  await saveStorage({ memberAccessToken: '', memberSessionToken: '' });
  if (chrome.storage.session) {
    await new Promise(resolve => chrome.storage.session.remove('memberSession', resolve));
  }
  $('#settingsOverlay').hide();
  showLoggedOut('You have been logged out.');
});

$('#saveSettingsBtn').on('click', async () => {
  const url = ($('#settingServerUrl').val() || '').trim().replace(/\/+$/, '');
  const membership = ($('#settingMembershipUrl').val() || '').trim().replace(/\/+$/, '');
  const key = ($('#settingApiKey').val() || '').trim();

  if (!url || !membership) {
    $('#settingsStatus').css('color', '#e74c3c').text('Both server URLs are required.');
    return;
  }

  $('#settingsStatus').css('color', '#aaa').text('Testing connection...');

  try {
    const headers = {};
    if (key) headers['X-API-Key'] = key;
    const res = await fetch(`${url}/api/extension/config`, { headers });
    if (!res.ok) throw new Error('Could not connect — check URL and key');

    await saveStorage({ serverUrl: url, membershipUrl: membership, apiKey: key });
    serverUrl = url;
    membershipUrl = membership;
    apiKey = key;
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
  const keyForCapture = memberAccessToken || apiKey;
  if (!serverUrl || !keyForCapture) {
    showNotification('Not connected', 'Set your server URL and API key in settings, or log in with a Sharely subscription.');
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

    const keyForCapture = memberAccessToken || apiKey;
    const res = await fetch(`${serverUrl}/api/capture`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': keyForCapture,
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
    try {
      await chrome.tabs.create({ url: stored.serverUrl });
    } catch (e) {
      window.open(stored.serverUrl, '_blank');
    }
  } else {
    showNotification('Not configured', 'Set your server URL in settings first.');
    setTimeout(closeNotification, 2000);
  }
});

// Initialise
$(async () => {
  const stored = await loadStorage();

  serverUrl = (stored.serverUrl || '').replace(/\/+$/, '');
  membershipUrl = (stored.membershipUrl || '').replace(/\/+$/, '');
  apiKey = stored.apiKey || '';
  memberAccessToken = stored.memberAccessToken || '';

  if (stored.theme) applyTheme(stored.theme);

  if (!serverUrl || !membershipUrl) {
    showError('Server not configured. Contact support.');
    disableFilters();
    return;
  }

  // Poll every 5 minutes — if session expires the extension transitions to logged-out state
  setInterval(() => { fetchConfig(); }, 5 * 60 * 1000);

  fetchConfig();
});
