const params = new URLSearchParams(location.search);
const orderId = params.get('order_id');
let email = params.get('email') || '';
const isPending = params.get('pending');

const emailInput = document.getElementById('emailInput');
if (email) {
  emailInput.value = email;
  emailInput.readOnly = true;
} else {
  // Email not in URL (e.g. Midtrans finish redirect without email param).
  // Make it editable so the guest can type it in; we'll also try fetching
  // it server-side from the transaction record.
  emailInput.readOnly = false;
  emailInput.placeholder = 'Enter the email you used at checkout';
}

// ── Polling state ──────────────────────────────────────────────────────────
let pollInterval = null;
let pollCount = 0;
const POLL_INTERVAL_MS = 4000;
const POLL_MAX = 75; // 75 × 4s = 5 minutes

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

function showPollingUI() {
  document.getElementById('createAccountForm').style.display = 'none';
  document.getElementById('loadingAccount').style.display = 'none';
  document.getElementById('pendingPolling').style.display = 'block';
  document.querySelector('#successCard .mp-auth-sub').textContent =
    'Waiting for payment confirmation…';
}

function showTimeoutUI() {
  document.getElementById('pendingPolling').style.display = 'none';
  document.getElementById('pendingTimeout').style.display = 'block';
  const el = document.getElementById('timeoutOrderId');
  if (el) el.textContent = orderId || '—';
  document.querySelector('#successCard .mp-auth-sub').textContent =
    'Payment confirmation is taking longer than expected.';
}

// ── Transaction check ──────────────────────────────────────────────────────
async function checkTransaction() {
  try {
    const res = await fetch('/api/membership/transaction/' + encodeURIComponent(orderId));
    if (!res.ok) throw new Error('Transaction check failed');
    const data = await res.json();

    if (data.status === 'paid') {
      stopPolling();
      // Recover email from server if it wasn't in the URL
      if (!email && data.customer_email) {
        email = data.customer_email;
        emailInput.value = email;
        emailInput.readOnly = true;
      }
      const meRes = await fetch('/api/membership/me');
      if (meRes.ok) {
        // Logged-in member: auto-complete and redirect
        await autoCompleteForMember();
        return;
      }
      // Guest: hide polling UI, show create-account form
      document.getElementById('pendingPolling').style.display = 'none';
      document.getElementById('createAccountForm').style.display = 'block';
      document.querySelector('#successCard .mp-auth-sub').textContent =
        'Payment confirmed! Create your account to get started.';
    } else if (data.status === 'failed') {
      stopPolling();
      window.location.href = '/membership/checkout/failed';
    } else if (data.status === 'pending') {
      // Still pending — keep polling (handled by startPolling)
    }
  } catch (err) {
    console.error('[checkTransaction]', err);
  }
}

function startPolling() {
  showPollingUI();
  pollCount = 0;
  // Run once immediately, then on interval
  checkTransaction();
  pollInterval = setInterval(async () => {
    pollCount++;
    if (pollCount >= POLL_MAX) {
      stopPolling();
      showTimeoutUI();
      return;
    }
    await checkTransaction();
  }, POLL_INTERVAL_MS);
}

// ── Account activation ─────────────────────────────────────────────────────
async function autoCompleteForMember() {
  const btn = document.getElementById('submitBtn');
  const alertBox = document.getElementById('alertBox');
  alertBox.classList.remove('show');
  if (btn) btn.disabled = true;
  document.getElementById('createAccountForm').style.display = 'none';
  document.getElementById('pendingPolling').style.display = 'none';
  document.getElementById('loadingAccount').style.display = 'block';
  document.querySelector('#successCard .mp-auth-sub').textContent = 'Activating your subscription…';

  try {
    const res = await fetch('/api/membership/checkout-complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: orderId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Activation failed');
    window.location.href = '/membership/dashboard';
  } catch (err) {
    document.getElementById('loadingAccount').style.display = 'none';
    document.getElementById('createAccountForm').style.display = 'block';
    if (btn) btn.disabled = false;
    alertBox.textContent = err.message;
    alertBox.classList.add('show');
  }
}

document.getElementById('createAccountForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('submitBtn');
  const alertBox = document.getElementById('alertBox');
  alertBox.classList.remove('show');
  btn.disabled = true;
  document.getElementById('createAccountForm').style.display = 'none';
  document.getElementById('loadingAccount').style.display = 'block';

  try {
    const res = await fetch('/api/membership/checkout-complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        order_id: orderId,
        email: document.getElementById('emailInput').value,
        name: document.getElementById('nameInput').value,
        password: document.getElementById('passwordInput').value,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Account creation failed');

    window.location.href = '/membership/dashboard';
  } catch (err) {
    document.getElementById('loadingAccount').style.display = 'none';
    document.getElementById('createAccountForm').style.display = 'block';
    alertBox.textContent = err.message;
    alertBox.classList.add('show');
    btn.disabled = false;
  }
});

// ── Initialise ─────────────────────────────────────────────────────────────
if (orderId) {
  if (isPending) {
    // QRIS / bank transfer: payment is async — start polling immediately
    startPolling();
  } else {
    // Snap reported onSuccess — do a single status check then show form
    checkTransaction();
  }
}
