/* sharely-extension.js for Sharely Extension 1.0 */

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

function buildServiceIcon(service) {
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
    const hasCookies = service.cookies && service.cookies.length > 0;
    const $item = $(`
      <div class="col-3 text-center service" data-category="${service.category}" data-id="${service.id}">
        <div style="position:relative;display:inline-block">
          ${buildServiceIcon(service)}
          ${hasCookies ? '' : '<span class="overlay">–</span>'}
        </div>
        <p class="menu-text">${service.name}</p>
      </div>
    `);

    $item.on('click', function() {
      if (!hasCookies) {
        showNotification('No cookies available', `${service.name} has no cookies configured yet.`);
        return;
      }
      injectCookies(service);
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

async function injectCookies(service) {
  showNotification('Injecting...', `Setting up access to ${service.name}...`);

  try {
    let successCount = 0;
    for (const cookie of service.cookies) {
      try {
        const cookieDomain = cookie.domain.startsWith('.') ? cookie.domain : '.' + cookie.domain;
        const url = `https://${cookieDomain.replace(/^\./, '')}${cookie.path || '/'}`;
        await chrome.cookies.set({
          url: url,
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path || '/',
          secure: cookie.secure !== false,
          httpOnly: cookie.httpOnly || false,
          sameSite: (cookie.sameSite || 'lax').toLowerCase(),
          expirationDate: cookie.expirationDate && cookie.expirationDate > 0 ? cookie.expirationDate : undefined,
        });
        successCount++;
      } catch (e) {
        console.warn('Failed to set cookie:', cookie.name, e.message);
      }
    }

    closeNotification();
    setTimeout(() => {
      showNotification('Access Granted!', `${service.name} is ready. Opening now...`);
      setTimeout(() => {
        chrome.tabs.create({ url: `https://${service.domain}` });
        closeNotification();
      }, 1200);
    }, 100);

  } catch (err) {
    closeNotification();
    showNotification('Error', 'Failed to inject cookies: ' + err.message);
  }
}

async function clearAllCookies() {
  if (!confirm('Clear all session cookies from Sharely services?')) return;

  let cleared = 0;
  for (const service of allServices) {
    try {
      const cookies = await new Promise(resolve =>
        chrome.cookies.getAll({ domain: service.domain }, resolve)
      );
      for (const cookie of cookies) {
        const url = `https://${cookie.domain.replace(/^\./, '')}${cookie.path}`;
        await chrome.cookies.remove({ url, name: cookie.name });
        cleared++;
      }
    } catch (e) { }
  }

  showNotification('Logged Out', `Cleared ${cleared} cookies from all services.`);
  setTimeout(closeNotification, 2000);
}

function showNotification(title, message) {
  const $modal = $('#notification-0');
  $modal.find('.notificationModal-content').html(`
    <i class="fas fa-times close-icon" id="closeNotif"></i>
    <h2>${title}</h2>
    <p>${message}</p>
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
      headers: {
        'X-API-Key': apiKey,
        'Accept': 'application/json'
      }
    });

    if (!res.ok) {
      throw new Error(`Server responded with status ${res.status}`);
    }

    const data = await res.json();
    allServices = data.services || [];
    currentCategory = 'all';
    $('.category-filter').removeClass('active');
    $('#all-category').addClass('active');
    filterAndRender();

    if (data.theme) {
      applyTheme(data.theme);
    }

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
$(document).on('click', '.category-filter:not([disabled])', function() {
  $('.category-filter').removeClass('active');
  $(this).addClass('active');
  currentCategory = $(this).data('category');
  filterAndRender();
});

// Search
$('#appSearch').on('input', filterAndRender);

// Toggle category filters
$('#toggleFilters').on('click', function() {
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

// Settings
$('#settingsButton').on('click', async () => {
  const stored = await loadStorage();
  $('#settingServerUrl').val(stored.serverUrl || '');
  $('#settingApiKey').val(stored.apiKey || '');
  $('#settingsStatus').text('');
  $('#settingsOverlay').show();
});

$('#closeSettings').on('click', () => $('#settingsOverlay').hide());

$('#openSettingsFromError').on('click', async () => {
  const stored = await loadStorage();
  $('#settingServerUrl').val(stored.serverUrl || '');
  $('#settingApiKey').val(stored.apiKey || '');
  $('#settingsStatus').text('');
  $('#settingsOverlay').show();
});

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
  if (stored.theme) {
    applyTheme(stored.theme);
  }
  fetchConfig();
});
