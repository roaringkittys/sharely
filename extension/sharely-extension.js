/* sharely-extension.js for Sharely Extension 1.2 */

const SHARELY_URL = 'https://sharely.id';

const API_KEY = 'sk_sharely_TUqm6Reu4pDTMYmy98Ini3PhZrD2ip0w';

let allServices = [];
let currentCategory = 'all';

let serverUrl = SHARELY_URL;
let membershipUrl = SHARELY_URL;
let apiKey = API_KEY;

/*
 * IMPORTANT:
 * Old system does NOT use access_token as the permanent member credential.
 *
 * Flow:
 * access_tokens.token
 *       ↓
 * /auth/extension-login
 *       ↓
 * session_token
 *       ↓
 * /auth/extension-verify
 */
let memberAccessToken = '';
let memberSessionToken = '';

let currentMemberEmail = '';
let currentMemberExpiry = '';
let currentMemberName = '';
let currentMemberPlan = '';


// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str).replace(
    /[&<>"']/g,
    c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[c])
  );
}

async function loadStorage() {
  return new Promise(resolve => {
    chrome.storage.local.get(
      [
        'memberSessionToken',
        'deviceFingerprint',
        'theme'
      ],
      resolve
    );
  });
}

async function saveStorage(data) {
  return new Promise(resolve => {
    chrome.storage.local.set(data, resolve);
  });
}


// ─────────────────────────────────────────────────────────────────────────────
// Logged-out state
// ─────────────────────────────────────────────────────────────────────────────

function showLoggedOut(message) {
  $('#loading').addClass('d-none');
  $('#loaded').addClass('d-none');
  $('#errored').addClass('d-none');

  $('#loggedOutState').removeClass('d-none');

  $('#loggedOutTitle').text('Log in to Sharely');

  $('#loggedOutMsg').text(
    message ||
    'Use your email and Sharely access token to load services.'
  );

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

  $('#loggedOutMsg').text(
    message ||
    'Your Sharely access has expired or is inactive.'
  );

  $('#extensionLoginForm').hide();
  $('#subscriptionInactive').show();

  disableFilters();

  memberAccessToken = '';
  memberSessionToken = '';

  saveStorage({
    memberAccessToken: '',
    memberSessionToken: ''
  });

  if (email) {
    currentMemberEmail = email;
    currentMemberExpiry = expiresAt || '';

    updateMemberFooter(
      email,
      expiresAt || new Date().toISOString()
    );
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// Member UI
// ─────────────────────────────────────────────────────────────────────────────

function updateMemberFooter(email, expiresAt) {
  if (!email) {
    $('#footer').text('Sharely © 2024–2025');
    return;
  }

  const days = Math.max(
    0,
    Math.ceil(
      (new Date(expiresAt) - new Date()) /
      (1000 * 60 * 60 * 24)
    )
  );

  const short =
    email.length > 22
      ? email.substring(0, 19) + '…'
      : email;

  let badge;

  if (days <= 0) {
    badge =
      '<span class="expiry-badge expiry-expired">Expired</span>';
  } else if (days <= 7) {
    badge =
      `<span class="expiry-badge expiry-soon">${days}d left</span>`;
  } else {
    badge =
      `<span class="expiry-badge expiry-ok">${days}d left</span>`;
  }

  $('#footer').html(`${short}&nbsp;${badge}`);
}

function updateMemberStrip(name, plan, expiresAt) {
  if (!name && !plan) {
    $('#memberStrip').addClass('d-none');
    return;
  }

  const days = Math.max(
    0,
    Math.ceil(
      (new Date(expiresAt) - new Date()) /
      (1000 * 60 * 60 * 24)
    )
  );

  const displayName = name || '';
  const displayPlan = plan || '';

  const dayStr =
    days > 0
      ? `${days}d left`
      : 'Expired';

  $('#memberStripText').text(
    `${displayName}${displayPlan ? ' · ' + displayPlan : ''} · ${dayStr}`
  );

  $('#memberStrip').removeClass('d-none');
}


// ─────────────────────────────────────────────────────────────────────────────
// Device fingerprint
// ─────────────────────────────────────────────────────────────────────────────

async function getDeviceFingerprint() {
  const stored = await loadStorage();

  if (stored.deviceFingerprint) {
    return stored.deviceFingerprint;
  }

  const raw = [
    navigator.userAgent,
    navigator.language,
    navigator.platform,
    screen.width,
    screen.height,
    screen.colorDepth
  ].join('|');

  const data = new TextEncoder().encode(raw);

  const hash = await crypto.subtle.digest(
    'SHA-256',
    data
  );

  const fingerprint = Array.from(
    new Uint8Array(hash)
  )
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  await saveStorage({
    deviceFingerprint: fingerprint
  });

  return fingerprint;
}


// ─────────────────────────────────────────────────────────────────────────────
// OLD SYSTEM SESSION CHECK
//
// Uses:
// GET /auth/extension-verify
//
// Header:
// X-User-Session: <session_token>
// ─────────────────────────────────────────────────────────────────────────────

async function checkSession() {
  if (!membershipUrl) {
    return null;
  }

  try {
    const stored = await loadStorage();

    const sessionToken =
      stored.memberSessionToken || '';

    memberSessionToken = sessionToken;

    if (!sessionToken) {
      return {
        authenticated: false
      };
    }

    const res = await fetch(
      `${membershipUrl}/auth/extension-verify`,
      {
        method: 'GET',
        headers: {
          'X-User-Session': sessionToken
        }
      }
    );

    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.valid || !data.user) {
      return {
        authenticated: false
      };
    }

    const expiresAt =
      data.user.access_expires_at || '';

    const now = new Date();

    if (
      expiresAt &&
      new Date(expiresAt) <= now
    ) {
      return {
        authenticated: true,
        user: data.user,
        subscription: {
          active: false,
          expires_at: expiresAt,
          plan: 'Sharely'
        }
      };
    }

    return {
      authenticated: true,

      user: data.user,

      subscription: {
        active: true,
        expires_at: expiresAt,
        plan: 'Sharely'
      }
    };

  } catch (e) {
    console.error(
      'Sharely session check error:',
      e
    );

    return {
      networkError: true
    };
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// Loading / error UI
// ─────────────────────────────────────────────────────────────────────────────

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

  if (msg) {
    $('#errorMsg').text(msg);
  }
}

function enableFilters() {
  $('.category-filter').prop('disabled', false);

  $('#appSearch')
    .prop('disabled', false)
    .attr('placeholder', 'Search services...');
}

function disableFilters() {
  $('.category-filter').prop('disabled', true);

  $('#appSearch')
    .prop('disabled', true)
    .attr('placeholder', 'Connecting...');
}


// ─────────────────────────────────────────────────────────────────────────────
// Service icons
// ─────────────────────────────────────────────────────────────────────────────

function buildServiceIcon(service) {
  if (service.icon_url) {
    return `
      <div class="service-img-icon">
        <img
          src="${serverUrl}${service.icon_url}"
          alt="${escapeHtml(service.name)}"
          onerror="this.parentElement.innerHTML='<span style=\\'font-size:28px\\'>${service.icon || '🌐'}</span>'"
        >
      </div>
    `;
  }

  if (service.icon && service.icon.length <= 4) {
    return `
      <div class="service-emoji-icon">
        ${service.icon}
      </div>
    `;
  }

  return `
    <div class="service-emoji-icon">
      🌐
    </div>
  `;
}


// ─────────────────────────────────────────────────────────────────────────────
// Render services
// ─────────────────────────────────────────────────────────────────────────────

function renderServices(services) {
  const $menu = $('#loaded');

  $menu.empty();

  if (services.length === 0) {
    $menu.html(`
      <div class="col-12 mt-4">
        <p style="color:#aaa;font-size:13px">
          No services found.
        </p>
      </div>
    `);

    showLoaded();
    return;
  }

  services.forEach(service => {
    const accounts =
      service.accounts || [];

    const subServices =
      service.sub_services || [];

    const hasSubServices =
      subServices.length > 0;

    const hasAccounts =
      accounts.length > 0;

    const accountCount =
      accounts.length;

    let badge = '';

    if (hasSubServices) {
      badge = `
        <span
          class="account-badge"
          style="background:linear-gradient(135deg,#6c5ce7,#a29bfe)"
        >
          ${subServices.length}
        </span>
      `;
    } else if (accountCount > 1) {
      badge = `
        <span class="account-badge">
          ${accountCount}
        </span>
      `;
    }

    const $item = $(`
      <div
        class="col-2 text-center service"
        data-category="${escapeHtml(service.category || '')}"
        data-id="${service.id}"
      >
        <div style="position:relative;display:inline-block">

          ${buildServiceIcon(service)}

          ${
            !hasSubServices && !hasAccounts
              ? '<span class="overlay">–</span>'
              : ''
          }

          ${badge}

        </div>

        <p class="menu-text">
          ${escapeHtml(service.name)}
        </p>
      </div>
    `);

    $item.on('click', function () {
      if (hasSubServices) {
        showSubServicesView(service);
        return;
      }

      if (!hasAccounts) {
        showNotification(
          'No accounts',
          `${service.name} has no cookies configured yet.`
        );
        return;
      }

      if (accountCount === 1) {
        doInject(
          service,
          accounts[0]
        );
      } else {
        showAccountPicker(
          service,
          accounts
        );
      }
    });

    $menu.append($item);
  });

  showLoaded();
  enableFilters();
}


// ─────────────────────────────────────────────────────────────────────────────
// Sub-services
// ─────────────────────────────────────────────────────────────────────────────

function showSubServicesView(parentService) {
  const subServices =
    parentService.sub_services || [];

  const $sub =
    $('#subView').empty();

  if (subServices.length === 0) {
    $sub.html(`
      <div class="col-12 mt-4">
        <p style="color:#aaa;font-size:13px">
          No sub-services configured.
        </p>
      </div>
    `);
  } else {
    subServices.forEach(service => {
      const accounts =
        service.accounts || [];

      const hasAccounts =
        accounts.length > 0;

      const accountCount =
        accounts.length;

      const badge =
        accountCount > 1
          ? `<span class="account-badge">${accountCount}</span>`
          : '';

      const $item = $(`
        <div
          class="col-2 text-center service"
          data-id="${service.id}"
        >
          <div style="position:relative;display:inline-block">

            ${buildServiceIcon(service)}

            ${
              !hasAccounts
                ? '<span class="overlay">–</span>'
                : ''
            }

            ${badge}

          </div>

          <p class="menu-text">
            ${escapeHtml(service.name)}
          </p>
        </div>
      `);

      $item.on('click', function () {
        if (!hasAccounts) {
          showNotification(
            'No accounts',
            `${service.name} has no cookies configured yet.`
          );
          return;
        }

        if (accountCount === 1) {
          doInject(
            service,
            accounts[0]
          );
        } else {
          showAccountPicker(
            service,
            accounts
          );
        }
      });

      $sub.append($item);
    });
  }

  $('#mainViewHeader').css(
    'display',
    'none'
  );

  $('#subViewHeader').css(
    'display',
    'flex'
  );

  $('#subViewTitle').text(
    parentService.name
  );

  $('#filtersToggleRow').hide();
  $('#categoryFiltersContainer').hide();

  $('#loaded').addClass('d-none');
  $('#subView').removeClass('d-none');
}

function closeSubServicesView() {
  $('#subView').addClass('d-none');

  $('#subViewHeader').css(
    'display',
    'none'
  );

  $('#mainViewHeader').css(
    'display',
    'contents'
  );

  $('#filtersToggleRow').show();

  const filtersHidden =
    $('#categoryFiltersContainer')
      .hasClass('hidden');

  if (!filtersHidden) {
    $('#categoryFiltersContainer').show();
  }

  $('#loaded').removeClass('d-none');
}

function filterAndRender() {
  const query =
    ($('#appSearch').val() || '')
      .toLowerCase();

  let filtered =
    allServices;

  if (currentCategory !== 'all') {
    filtered =
      filtered.filter(
        s => s.category === currentCategory
      );
  }

  if (query) {
    filtered =
      filtered.filter(s =>
        (s.name || '')
          .toLowerCase()
          .includes(query) ||

        (s.domain || '')
          .toLowerCase()
          .includes(query)
      );
  }

  renderServices(filtered);
}


// ─────────────────────────────────────────────────────────────────────────────
// Account picker
// ─────────────────────────────────────────────────────────────────────────────

function showAccountPicker(
  service,
  accounts
) {
  const iconHtml =
    service.icon_url
      ? `
        <img
          src="${serverUrl}${service.icon_url}"
          style="width:36px;height:36px;border-radius:8px;object-fit:cover"
          onerror="this.outerHTML='<span style=\\'font-size:28px\\'>${service.icon || '🌐'}</span>'"
        >
      `
      : `
        <span style="font-size:28px">
          ${service.icon || '🌐'}
        </span>
      `;

  const pickIcon = acc => {
    if (service.icon_url) {
      return `
        <div class="pick-icon">
          <img
            src="${serverUrl}${service.icon_url}"
            alt=""
            onerror="this.parentElement.innerHTML='<span style=font-size:28px>${service.icon || '🌐'}</span>'"
          >
        </div>
      `;
    }

    if (
      service.icon &&
      service.icon.length <= 4
    ) {
      return `
        <div class="pick-icon">
          ${service.icon}
        </div>
      `;
    }

    return `
      <div class="pick-icon">
        🌐
      </div>
    `;
  };

  const cards =
    accounts.map((acc, i) => `
      <div
        class="account-pick-card"
        data-idx="${i}"
      >
        ${pickIcon(acc)}

        <div class="pick-label">
          ${escapeHtml(acc.label)}
        </div>
      </div>
    `).join('');

  $('#accountPickerTitle').html(
    `${iconHtml} <span>${escapeHtml(service.name)}</span>`
  );

  $('#accountPickerList').html(cards);

  $('#accountPickerOverlay')
    .css('display', 'flex')
    .hide()
    .fadeIn(150);

  $('#accountPickerList')
    .off(
      'click',
      '.account-pick-card'
    )
    .on(
      'click',
      '.account-pick-card',
      function () {
        const idx =
          parseInt(
            $(this).data('idx')
          );

        closeAccountPicker();

        doInject(
          service,
          accounts[idx]
        );
      }
    );
}

function closeAccountPicker() {
  $('#accountPickerOverlay')
    .fadeOut(120);
}


// ─────────────────────────────────────────────────────────────────────────────
// Cookie injection
// ─────────────────────────────────────────────────────────────────────────────

function doInject(
  service,
  account
) {
  showNotification(
    'Injecting...',
    `Setting up "${account.label}" for ${service.name} (${account.cookies.length} cookies)...`
  );

  const targetUrl =
    `https://${service.domain.replace(/^\./, '')}`;

  chrome.runtime.sendMessage(
    {
      type: 'INJECT_AND_OPEN',
      cookies: account.cookies,
      targetUrl
    },
    response => {
      if (chrome.runtime.lastError) {
        closeNotification();

        showNotification(
          'Error',
          'Background error: ' +
          chrome.runtime.lastError.message
        );

        return;
      }

      if (
        response &&
        response.success
      ) {
        const {
          results
        } = response;

        const ok =
          results.success.length;

        const bad =
          results.failed.length;

        const total =
          ok + bad;

        if (bad === 0) {
          showNotification(
            '✅ Done!',
            `${ok}/${total} cookies set. Opening ${service.name}...`
          );
        } else {
          const failMsg =
            results.failed
              .map(
                f =>
                  `${f.name}: ${f.reason}`
              )
              .join('\n');

          showNotification(
            `⚠️ Partial (${ok}/${total})`,
            `Some cookies failed:\n${failMsg}`
          );
        }

        setTimeout(
          closeNotification,
          3500
        );

      } else {
        closeNotification();

        showNotification(
          'Error',
          'Inject failed: ' +
          (
            response &&
            response.error
          || 'Unknown'
          )
        );
      }
    }
  );
}

async function clearAllCookies() {
  if (
    !confirm(
      'Clear all session cookies from Sharely services?'
    )
  ) {
    return;
  }

  const domains =
    allServices.map(
      s =>
        s.domain.replace(
          /^\./,
          ''
        )
    );

  chrome.runtime.sendMessage(
    {
      type: 'CLEAR_ALL',
      domains
    },
    response => {
      if (
        response &&
        response.success
      ) {
        showNotification(
          'Logged Out',
          `Cleared ${response.cleared} cookies from all services.`
        );
      } else {
        showNotification(
          'Logged Out',
          'Cookies cleared.'
        );
      }

      setTimeout(
        closeNotification,
        2000
      );
    }
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// Notifications
// ─────────────────────────────────────────────────────────────────────────────

function showNotification(
  title,
  message
) {
  const $modal =
    $('#notification-0');

  const safeMsg =
    String(message)
      .replace(
        /&/g,
        '&amp;'
      )
      .replace(
        /</g,
        '&lt;'
      )
      .replace(
        />/g,
        '&gt;'
      )
      .replace(
        /\n/g,
        '<br>'
      );

  $modal
    .find(
      '.notificationModal-content'
    )
    .html(`
      <i
        class="fas fa-times close-icon"
        id="closeNotif"
      ></i>

      <h2>${escapeHtml(title)}</h2>

      <p
        style="text-align:left;font-size:11px;line-height:1.6"
      >
        ${safeMsg}
      </p>
    `);

  $modal.css({
    display: 'flex',
    opacity: 1,
    visibility: 'visible'
  });

  $('#closeNotif')
    .on(
      'click',
      closeNotification
    );
}

function closeNotification() {
  $('#notification-0').css({
    opacity: 0,
    visibility: 'hidden'
  });
}


// ─────────────────────────────────────────────────────────────────────────────
// Fetch services
// ─────────────────────────────────────────────────────────────────────────────

  async function fetchConfig() {

  const stored =
    await loadStorage();

  serverUrl =
    SHARELY_URL;

  membershipUrl =
    SHARELY_URL;

  apiKey =
    API_KEY;

  if (!serverUrl) {
    showError(
      'Configure your server URL in settings first.'
    );

    disableFilters();
    return;
  }

  showLoading();

  try {
    // Check OLD Sharely user session
    const sessionData =
      await checkSession();

    if (
      sessionData &&
      sessionData.networkError
    ) {
      showError(
        'Network error. Check your connection and try again.'
      );

      disableFilters();
      return;
    }

    if (sessionData) {

      // ─────────────────────────────────────
      // Authenticated old-system user
      // ─────────────────────────────────────

      if (
        sessionData.authenticated &&
        sessionData.subscription &&
        sessionData.subscription.active
      ) {
        currentMemberEmail =
          sessionData.user.email || '';

        currentMemberName =
          sessionData.user.name || '';

        currentMemberExpiry =
          sessionData.subscription.expires_at || '';

        currentMemberPlan =
          sessionData.subscription.plan || 'Sharely';

        // OLD SYSTEM DOES NOT USE members.access_token
        memberAccessToken = '';

        updateMemberFooter(
          currentMemberEmail,
          currentMemberExpiry
        );

        updateMemberStrip(
          currentMemberName,
          currentMemberPlan,
          currentMemberExpiry
        );

        /*
         * Keep service API authentication separate.
         *
         * The old membership session authenticates the user.
         * apiKey remains the service/API key if configured.
         */
        const configHeaders =
          API_KEY
            ? {
                'X-API-Key': API_KEY
              }
            : {};

        const configRes =
          await fetch(
            `${serverUrl}/api/extension/config`,
            {
              headers: configHeaders
            }
          );

        if (configRes.ok) {
          const data =
            await configRes.json();

          allServices =
            data.services || [];

          currentCategory =
            'all';

          $('.category-filter')
            .removeClass('active');

          $('#all-category')
            .addClass('active');

          filterAndRender();

          if (data.theme) {
            applyTheme(
              data.theme
            );
          }

          return;
        }

        if (
          configRes.status === 401 ||
          configRes.status === 403
        ) {
          showError(
            'Service authentication failed. Contact Sharely support.'
          );

          return;
        }

        throw new Error(
          `Service server responded with status ${configRes.status}`
        );
      }


      // ─────────────────────────────────────
      // Expired old-system user
      // ─────────────────────────────────────

      if (
        sessionData.authenticated &&
        sessionData.subscription &&
        !sessionData.subscription.active
      ) {
        showSubscriptionInactive(
          'Your Sharely access has expired. Please renew your membership.',
          sessionData.user &&
            sessionData.user.email,
          sessionData.subscription &&
            sessionData.subscription.expires_at
        );

        return;
      }


      // ─────────────────────────────────────
      // No valid session
      // ─────────────────────────────────────

      if (
        !sessionData.authenticated
      ) {
        await saveStorage({
          memberSessionToken: ''
        });

        memberSessionToken = '';

        showLoggedOut();

        return;
      }
    }

    showLoggedOut();

  } catch (err) {
    console.error(
      'Sharely fetch error:',
      err
    );

    showError(
      'Cannot connect to Sharely server. Check your settings.'
    );

    disableFilters();
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// OLD SYSTEM LOGIN
//
// POST /auth/extension-login
//
// Sends:
// email
// token
// deviceFingerprint
//
// Receives:
// session_token
// access_expires_at
// ─────────────────────────────────────────────────────────────────────────────

async function loginExtension() {
  const email =
    ($('#extensionEmail').val() || '')
      .trim();

  const token =
    ($('#extensionToken').val() || '')
      .trim();

  const $button =
    $('#extensionLoginBtn');

  const $error =
    $('#extensionLoginError');

  $error
    .hide()
    .text('');

  if (!email || !token) {
    $error
      .text(
        'Enter your email and access token.'
      )
      .show();

    return;
  }

  $button
    .prop('disabled', true)
    .text('Logging in…');

  try {
    const deviceFingerprint =
      await getDeviceFingerprint();

    const res =
      await fetch(
        `${membershipUrl}/auth/extension-login`,
        {
          method: 'POST',

          headers: {
            'Content-Type':
              'application/json'
          },

          body: JSON.stringify({
            email,
            token,
            deviceFingerprint
          })
        }
      );

    const data =
      await res
        .json()
        .catch(
          () => ({})
        );

    if (
      !res.ok ||
      !data.success
    ) {
      $error
        .text(
          data.error ||
          'Login failed. Check your email and access token.'
        )
        .show();

      return;
    }

    const sessionToken =
      data.session_token || '';

    if (!sessionToken) {
      $error
        .text(
          'Login succeeded but no session token was returned.'
        )
        .show();

      return;
    }

    // Save old-system session
    await saveStorage({
      memberSessionToken:
        sessionToken,

      memberAccessToken:
        '',

      currentMemberEmail:
        data.email || email,

      currentMemberExpiry:
        data.access_expires_at || ''
    });

    memberSessionToken =
      sessionToken;

    memberAccessToken =
      '';

    currentMemberEmail =
      data.email || email;

    currentMemberExpiry =
      data.access_expires_at || '';

    currentMemberName =
      '';

    currentMemberPlan =
      'Sharely';

    updateMemberFooter(
      currentMemberEmail,
      currentMemberExpiry
    );

    updateMemberStrip(
      currentMemberName,
      currentMemberPlan,
      currentMemberExpiry
    );

    // Reload extension using the new session
    await fetchConfig();

  } catch (err) {
    console.error(
      'Sharely old login error:',
      err
    );

    $error
      .text(
        'Network error. Check your connection and try again.'
      )
      .show();

  } finally {
    $button
      .prop('disabled', false)
      .text('Log in');
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// Theme
// ─────────────────────────────────────────────────────────────────────────────

function applyTheme(theme) {
  if (theme === 'light') {
    $('body')
      .addClass('light-theme');

    $('#theme-light')
      .removeClass('d-none');

    $('#theme-dark')
      .addClass('d-none');

  } else {
    $('body')
      .removeClass('light-theme');

    $('#theme-dark')
      .removeClass('d-none');

    $('#theme-light')
      .addClass('d-none');
  }

  saveStorage({
    theme
  });
}


// ─────────────────────────────────────────────────────────────────────────────
// Category filter
// ─────────────────────────────────────────────────────────────────────────────

$(document).on(
  'click',
  '.category-filter:not([disabled])',
  function () {
    $('.category-filter')
      .removeClass('active');

    $(this)
      .addClass('active');

    currentCategory =
      $(this).data('category');

    filterAndRender();
  }
);


// ─────────────────────────────────────────────────────────────────────────────
// Search
// ─────────────────────────────────────────────────────────────────────────────

$('#appSearch')
  .on(
    'input',
    filterAndRender
  );


// ─────────────────────────────────────────────────────────────────────────────
// Toggle filters
// ─────────────────────────────────────────────────────────────────────────────

$('#toggleFilters')
  .on(
    'click',
    function () {
      $(this)
        .toggleClass('rotated');

      $('#categoryFiltersContainer')
        .toggleClass('hidden');
    }
  );


// ─────────────────────────────────────────────────────────────────────────────
// Navigation
// ─────────────────────────────────────────────────────────────────────────────

$('#backBtn')
  .on(
    'click',
    closeSubServicesView
  );

$('#refreshButton')
  .on(
    'click',
    () => {
      if (
        $('#subView').is(':visible')
      ) {
        closeSubServicesView();
      }

      fetchConfig();
    }
  );


// ─────────────────────────────────────────────────────────────────────────────
// Logout / cookies
// ─────────────────────────────────────────────────────────────────────────────

$('#safeLogout')
  .on(
    'click',
    clearAllCookies
  );


// ─────────────────────────────────────────────────────────────────────────────
// Theme buttons
// ─────────────────────────────────────────────────────────────────────────────

$('#theme-light')
  .on(
    'click',
    () => applyTheme('dark')
  );

$('#theme-dark')
  .on(
    'click',
    () => applyTheme('light')
  );


// ─────────────────────────────────────────────────────────────────────────────
// Account picker
// ─────────────────────────────────────────────────────────────────────────────

$('#accountPickerClose, #accountPickerOverlay')
  .on(
    'click',
    closeAccountPicker
  );

$('#accountPicker')
  .on(
    'click',
    function (e) {
      e.stopPropagation();
    }
  );


// ─────────────────────────────────────────────────────────────────────────────
// Settings login link
// ─────────────────────────────────────────────────────────────────────────────

$('#settingsLoginLink')
  .on(
    'click',
    async e => {
      e.preventDefault();

      $('#settingsOverlay')
        .hide();

      const url =
        membershipUrl
          ? `${membershipUrl}/membership/login`
          : `${SHARELY_URL}/membership/login`;

      try {
        await chrome.tabs.create({
          url
        });
      } catch (_) {
        window.open(
          url,
          '_blank'
        );
      }
    }
  );


// ─────────────────────────────────────────────────────────────────────────────
// Login button
// ─────────────────────────────────────────────────────────────────────────────

$('#extensionLoginBtn')
  .on(
    'click',
    loginExtension
  );

$('#extensionToken')
  .on(
    'keydown',
    e => {
      if (e.key === 'Enter') {
        loginExtension();
      }
    }
  );


// ─────────────────────────────────────────────────────────────────────────────
// Purchase membership
// ─────────────────────────────────────────────────────────────────────────────

$('#purchaseMembershipBtn')
  .on(
    'click',
    async () => {
      const url =
        membershipUrl
          ? `${membershipUrl}/membership/pricing`
          : `${SHARELY_URL}/membership/pricing`;

      try {
        await chrome.tabs.create({
          url
        });
      } catch (_) {
        window.open(
          url,
          '_blank'
        );
      }
    }
  );


// ─────────────────────────────────────────────────────────────────────────────
// Sign out
// ─────────────────────────────────────────────────────────────────────────────

$('#signOutBtn')
  .on(
    'click',
    async () => {
      memberAccessToken = '';
      memberSessionToken = '';

      currentMemberEmail = '';
      currentMemberExpiry = '';
      currentMemberName = '';
      currentMemberPlan = '';

      await saveStorage({
        memberAccessToken: '',
        memberSessionToken: ''
      });

      if (
        chrome.storage.session
      ) {
        await new Promise(
          resolve =>
            chrome.storage.session.remove(
              'memberSession',
              resolve
            )
        );
      }

      $('#settingsOverlay')
        .hide();

      showLoggedOut(
        'You have been logged out.'
      );
    }
  );



// ─────────────────────────────────────────────────────────────────────────────
// One-Click Capture
// ─────────────────────────────────────────────────────────────────────────────

let capturedCookiesCache = [];
let capturedDomainCache = '';

function closeCaptureOverlay() {
  $('#captureOverlay')
    .fadeOut(150);
}

$('#captureButton')
  .on(
    'click',
    () => {
      const keyForCapture =
        API_KEY;

      if (
        !serverUrl ||
        !keyForCapture
      ) {
        showNotification(
          'Not connected',
          'Sharely server unavailable.'
        );

        setTimeout(
          closeNotification,
          2500
        );

        return;
      }

      capturedCookiesCache = [];
      capturedDomainCache = '';

      $('#captureScanning')
        .show();

      $('#captureReady')
        .hide();

      $('#captureError')
        .hide();

      $('#captureLabelInput')
        .val('');

      $('#captureOverlay')
        .css(
          'display',
          'flex'
        )
        .hide()
        .fadeIn(150);

      chrome.runtime.sendMessage(
        {
          type: 'GET_SITE_COOKIES'
        },
        response => {
          if (
            chrome.runtime.lastError ||
            !response ||
            !response.success
          ) {
            const err =
              (
                response &&
                response.error
              ) ||
              'Could not read tab cookies.';

            $('#captureScanning')
              .hide();

            $('#captureError')
              .show();

            $('#captureErrorMsg')
              .text(err);

            return;
          }

          const {
            hostname,
            rootDomain,
            tabTitle,
            cookies
          } = response;

          capturedCookiesCache =
            cookies;

          capturedDomainCache =
            rootDomain;

          if (
            cookies.length === 0
          ) {
            $('#captureScanning')
              .hide();

            $('#captureError')
              .show();

            $('#captureErrorMsg')
              .text(
                `No cookies found on ${hostname}. Make sure you are logged in.`
              );

            return;
          }

          $('#captureSiteInfo')
            .html(`
              <div>
                <div class="capture-site-domain">
                  ${escapeHtml(hostname)}
                </div>

                <div class="capture-site-tab">
                  ${escapeHtml(tabTitle)}
                </div>
              </div>
            `);

          $('#captureCookieCount')
            .text(
              cookies.length
            );

          $('#captureScanning')
            .hide();

          $('#captureReady')
            .show();
        }
      );
    }
  );

$('#captureClose')
  .on(
    'click',
    closeCaptureOverlay
  );

$('#captureOverlay')
  .on(
    'click',
    function (e) {
      if (e.target === this) {
        closeCaptureOverlay();
      }
    }
  );

$('#captureConfirmBtn')
  .on(
    'click',
    async () => {
      if (
        !capturedCookiesCache.length
      ) {
        return;
      }

      const label =
        $('#captureLabelInput')
          .val()
          .trim() ||
        undefined;

      $('#captureConfirmBtn')
        .prop(
          'disabled',
          true
        )
        .text(
          'Sending...'
        );

      try {
        const payload = {
          domain:
            capturedDomainCache,

          cookies:
            capturedCookiesCache.map(
              c => ({
                name: c.name,
                value: c.value,
                domain: c.domain,
                path: c.path,
                secure: c.secure,
                httpOnly: c.httpOnly,
                expirationDate:
                  c.expirationDate
              })
            ),

          label
        };

        const keyForCapture =
          API_KEY;

        const res =
          await fetch(
            `${serverUrl}/api/capture`,
            {
              method: 'POST',

              headers: {
                'Content-Type':
                  'application/json',

                'X-API-Key':
                  keyForCapture
              },

              body:
                JSON.stringify(
                  payload
                )
            }
          );

        const data =
          await res.json();

        if (data.success) {
          closeCaptureOverlay();

          showNotification(
            '✅ Captured!',
            `${data.count} cookies saved to "${data.service_name}" as "${data.label}". Refreshing...`
          );

          setTimeout(
            () => {
              closeNotification();
              fetchConfig();
            },
            2000
          );

        } else {
          throw new Error(
            data.error ||
            'Unknown server error'
          );
        }

      } catch (err) {
        $('#captureConfirmBtn')
          .prop(
            'disabled',
            false
          )
          .html(
            '<i class="fas fa-upload" style="margin-right:6px"></i>Send to Dashboard'
          );

        $('#captureReady')
          .hide();

        $('#captureError')
          .show();

        $('#captureErrorMsg')
          .text(
            'Failed: ' +
            err.message
          );
      }
    }
  );


// ─────────────────────────────────────────────────────────────────────────────
// Admin dashboard
// ─────────────────────────────────────────────────────────────────────────────

$('#adminButton')
  .on(
    'click',
    async () => {
      const stored =
        await loadStorage();

      if (stored.serverUrl) {
        try {
          await chrome.tabs.create({
            url: stored.serverUrl
          });
        } catch (e) {
          window.open(
            stored.serverUrl,
            '_blank'
          );
        }
      } else {
        showNotification(
          'Not configured',
          'Set your server URL in settings first.'
        );

        setTimeout(
          closeNotification,
          2000
        );
      }
    }
  );


// ─────────────────────────────────────────────────────────────────────────────
// Initialise
// ─────────────────────────────────────────────────────────────────────────────

$(async () => {
  const stored =
    await loadStorage();

  serverUrl =
    SHARELY_URL;

  membershipUrl =
    SHARELY_URL;

    apikey =
      API_KEY;

  memberAccessToken =
    '';

  memberSessionToken =
    stored.memberSessionToken || '';

  if (stored.theme) {
    applyTheme(
      stored.theme
    );
  }

  if (
    !serverUrl ||
    !membershipUrl
  ) {
    showError(
      'Server not configured. Contact support.'
    );

    disableFilters();
    return;
  }

  // Check immediately
  await fetchConfig();

  // Re-check every 5 minutes
  setInterval(
    () => {
      fetchConfig();
    },
    5 * 60 * 1000
  );
});