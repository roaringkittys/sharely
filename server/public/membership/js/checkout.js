let plans = [];
let selectedPlan = null;
let memberData = null;
let paymentConfig = null;

const paymentFees = {
  qris_shopee: 750,
  qris: 750,
  bca_va: 5500,
  bni_va: 4250,
  bri_va: 4250,
  mandiri_va: 4250,
  alfamart: 3500,
};
const paymentPercent = 0.007;

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
  const planSelect = document.getElementById('planSelect');
  planSelect.innerHTML = plans.map(p =>
    `<option value="${p.id}">${p.name} (${MembershipUI.formatMoney(p.price_cents)})</option>`
  ).join('');

  if (!plans.length) {
    document.getElementById('alertBox').textContent = 'No plans available. Please try again later.';
    document.getElementById('alertBox').classList.add('show');
    document.getElementById('payBtn').disabled = true;
    document.getElementById('memberPayBtn').disabled = true;
    return;
  }

  // Auto-select plan from URL if provided
  const urlPlanId = new URLSearchParams(location.search).get('plan');
  if (urlPlanId) {
    const match = plans.find(p => String(p.id) === String(urlPlanId));
    if (match) planSelect.value = String(match.id);
  }

  selectedPlan = plans.find(p => String(p.id) === String(planSelect.value));
  if (!selectedPlan) selectedPlan = plans[0];

  planSelect.addEventListener('change', () => {
    selectedPlan = plans.find(p => String(p.id) === String(planSelect.value));
    updateSummary();
  });
  document.getElementById('paymentSelect').addEventListener('change', updateSummary);
  document.getElementById('promotionCode').addEventListener('input', debounce(updateSummary, 600));

  updateSummary();
}

function debounce(fn, ms) {
  let t;
  return () => { clearTimeout(t); t = setTimeout(fn, ms); };
}

function updateSummary() {
  if (!selectedPlan) return;

  const price = selectedPlan.price_cents;
  const method = document.getElementById('paymentSelect').value;
  const fee = (paymentFees[method] || 0) + Math.round(price * paymentPercent);
  const promo = document.getElementById('promotionCode').value.trim();
  const promoStatus = document.getElementById('promoStatus');

  let discount = 0;
  let promoMsg = '';

  if (promo) {
    // Simple hardcoded promo for demo; in real app, validate server-side
    const promoUpper = promo.toUpperCase();
    if (promoUpper === 'SHARELY50') {
      discount = Math.round(price * 0.50);
      promoMsg = '50% discount applied';
      promoStatus.style.color = '#16a34a';
    } else if (promoUpper === 'SHARELY25') {
      discount = Math.round(price * 0.25);
      promoMsg = '25% discount applied';
      promoStatus.style.color = '#16a34a';
    } else {
      promoMsg = 'Invalid promotion code';
      promoStatus.style.color = '#dc2626';
    }
  }

  promoStatus.textContent = promoMsg;

  const total = price + fee - discount;

  document.getElementById('summaryPlanLabel').textContent = selectedPlan.name;
  document.getElementById('summaryPrice').textContent = price.toLocaleString('id-ID');
  document.getElementById('summaryFee').textContent = fee.toLocaleString('id-ID');
  document.getElementById('summaryDiscount').textContent = discount.toLocaleString('id-ID');
  document.getElementById('summaryTotal').textContent = total.toLocaleString('id-ID');

  const discountRow = document.getElementById('summaryDiscountRow');
  discountRow.style.display = discount > 0 ? 'flex' : 'none';
}

async function startPayment(email, name) {
  const btn = document.getElementById('payBtn') || document.getElementById('memberPayBtn');
  const alertBox = document.getElementById('alertBox');
  alertBox.classList.remove('show');
  btn.disabled = true;
  btn.style.opacity = '0.6';
  btn.textContent = 'Opening payment…';

  try {
    const res = await fetch('/api/membership/snap-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan_id: selectedPlan.id, email, name }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Payment initialization failed');

    btn.textContent = 'Waiting for payment…';

    window.snap.pay(data.token, {
      onSuccess: function() {
        window.location.href = '/membership/checkout/success?order_id=' + encodeURIComponent(data.order_id) + '&email=' + encodeURIComponent(email);
      },
      onPending: function() {
        window.location.href = '/membership/checkout/success?order_id=' + encodeURIComponent(data.order_id) + '&email=' + encodeURIComponent(email) + '&pending=1';
      },
      onError: function() {
        window.location.href = '/membership/checkout/failed';
      },
      onClose: function() {
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.textContent = 'Purchase';
      }
    });
  } catch (err) {
    alertBox.textContent = err.message;
    alertBox.classList.add('show');
    btn.disabled = false;
    btn.style.opacity = '1';
    btn.textContent = 'Purchase';
  }
}

document.getElementById('payBtn').addEventListener('click', () => {
  const email = document.getElementById('emailInput').value.trim();
  const name = document.getElementById('nameInput').value.trim();
  if (!email || !name) {
    document.getElementById('alertBox').textContent = 'Please enter your email and name.';
    document.getElementById('alertBox').classList.add('show');
    return;
  }
  startPayment(email, name);
});

document.getElementById('memberPayBtn')?.addEventListener('click', () => {
  if (!memberData) return;
  startPayment(memberData.member.email, memberData.member.name);
});

init();
