let plans = [];
let selectedPlan = null;
let memberData = null;
let paymentConfig = null;

async function loadConfig() {
  const res = await fetch('/api/membership/payment-config');
  if (!res.ok) return;
  paymentConfig = await res.json();
  if (paymentConfig.clientKey) {
    const snapUrl = paymentConfig.isProduction
      ? 'https://app.midtrans.com/snap/snap.js'
      : 'https://app.sandbox.midtrans.com/snap/snap.js';
    const script = document.createElement('script');
    script.setAttribute('data-client-key', paymentConfig.clientKey);
    script.src = snapUrl;
    document.head.appendChild(script);
  }
}

function renderTiers() {
  const grid = document.getElementById('tierGrid');
  const featuredId = plans.length > 1 ? plans[1].id : (plans[0] && plans[0].id);
  grid.innerHTML = plans.map(p => {
    const feats = (p.features || []).map(f => `<li><i class="fa-solid fa-check"></i> ${f}</li>`).join('');
    return `
      <label class="gp-option gp-tier" data-plan="${p.id}">
        <input type="radio" name="tier" value="${p.id}">
        ${p.id === featuredId ? '<span class="gp-badge">POPULAR</span>' : ''}
        <span class="gp-tier-name">${p.name}</span>
        <span class="gp-tier-price"><span class="gp-tier-price-num">${MembershipUI.formatMoney(p.price_cents)}</span> <span class="gp-tier-per">/ ${p.duration_days || 30} days</span></span>
        <ul class="gp-features">${feats}</ul>
        <span class="gp-check"><i class="fa-solid fa-circle-check"></i></span>
      </label>`;
  }).join('');
  grid.querySelectorAll('input[name="tier"]').forEach(r =>
    r.addEventListener('change', () => selectPlan(r.value)));
}

function selectPlan(id) {
  selectedPlan = plans.find(p => String(p.id) === String(id)) || plans[0];
  document.querySelectorAll('.gp-tier').forEach(l => {
    const input = l.querySelector('input');
    const on = String(input.value) === String(selectedPlan.id);
    input.checked = on;
    l.classList.toggle('is-selected', on);
  });
  updateSummary();
}

function updateSummary() {
  if (!selectedPlan) return;
  document.getElementById('summaryPlanName').textContent =
    selectedPlan.name + ' · ' + (selectedPlan.duration_days || 30) + ' days';
  document.getElementById('summaryPrice').textContent = selectedPlan.price_cents.toLocaleString('id-ID');
  document.getElementById('summaryTotal').textContent = selectedPlan.price_cents.toLocaleString('id-ID');
}

function showAlert(msg) {
  const a = document.getElementById('alertBox');
  a.textContent = msg;
  a.classList.add('show');
}

async function init() {
  await loadConfig();

  const meRes = await fetch('/api/membership/me');
  if (meRes.ok) {
    memberData = await meRes.json();
    document.getElementById('guestForm').style.display = 'none';
    document.getElementById('memberForm').style.display = 'block';
    document.getElementById('memberEmail').textContent = memberData.member.email;
  }

  plans = await MembershipUI.fetchPlans();
  if (!plans.length) {
    document.getElementById('tierGrid').innerHTML = '<div style="color:var(--gp-muted);padding:16px 0">No plans available right now. Please try again later.</div>';
    document.getElementById('payBtn').disabled = true;
    return;
  }

  renderTiers();

  // preselect from ?plan= or default to first
  const urlPlanId = new URLSearchParams(location.search).get('plan');
  const match = urlPlanId && plans.find(p => String(p.id) === String(urlPlanId));
  selectPlan(match ? match.id : plans[0].id);
}

async function startPayment(email, name) {
  const btn = document.getElementById('payBtn');
  document.getElementById('alertBox').classList.remove('show');
  btn.disabled = true;
  btn.style.opacity = '0.6';
  btn.innerHTML = 'Opening payment…';

  try {
    const res = await fetch('/api/membership/snap-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan_id: selectedPlan.id, email, name }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Payment initialization failed');

    btn.innerHTML = 'Waiting for payment…';
    window.snap.pay(data.token, {
      onSuccess: function () {
        window.location.href = '/membership/checkout/success?order_id=' + encodeURIComponent(data.order_id) + '&email=' + encodeURIComponent(email);
      },
      onPending: function () {
        window.location.href = '/membership/checkout/success?order_id=' + encodeURIComponent(data.order_id) + '&email=' + encodeURIComponent(email) + '&pending=1';
      },
      onError: function () { window.location.href = '/membership/checkout/failed'; },
      onClose: function () {
        btn.disabled = false; btn.style.opacity = '1';
        btn.innerHTML = '<i class="fa-solid fa-lock"></i> Pay now';
      }
    });
  } catch (err) {
    showAlert(err.message);
    btn.disabled = false; btn.style.opacity = '1';
    btn.innerHTML = '<i class="fa-solid fa-lock"></i> Pay now';
  }
}

document.getElementById('payBtn').addEventListener('click', () => {
  if (!selectedPlan) { showAlert('Please choose a plan.'); return; }
  if (memberData) {
    startPayment(memberData.member.email, memberData.member.name);
  } else {
    const email = document.getElementById('emailInput').value.trim();
    const name = document.getElementById('nameInput').value.trim();
    if (!email || !name) { showAlert('Please enter your email and name.'); return; }
    startPayment(email, name);
  }
});

init();
