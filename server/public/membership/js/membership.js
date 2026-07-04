/* Shared membership frontend helpers */

const MembershipUI = (() => {
  function formatPrice(cents, interval) {
    const dollars = (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);
    return `$${dollars}<span>/${interval === 'year' ? 'yr' : 'mo'}</span>`;
  }

  async function fetchPlans() {
    const res = await fetch('/api/membership/plans');
    if (!res.ok) return [];
    return res.json();
  }

  function planCardHtml(plan, featured) {
    const features = (plan.features || []).map(f => `<li>${f}</li>`).join('');
    return `
      <div class="mp-plan ${featured ? 'mp-plan-featured' : ''}">
        ${featured ? '<div class="mp-plan-badge">Most popular</div>' : ''}
        <div class="mp-plan-name">${plan.name}</div>
        <p class="mp-plan-desc">${plan.description || ''}</p>
        <div class="mp-plan-price">${formatPrice(plan.price_cents, plan.billing_interval)}</div>
        <a href="/membership/signup?plan=${plan.id}" class="mp-btn ${featured ? 'mp-btn-primary' : 'mp-btn-ghost'} mp-btn-block mp-plan-cta">Choose ${plan.name}</a>
        <ul class="mp-plan-features">${features}</ul>
      </div>
    `;
  }

  async function renderPricingGrid(elementId, opts = {}) {
    const el = document.getElementById(elementId);
    if (!el) return;
    const plans = await fetchPlans();
    const featuredIndex = Math.min(1, plans.length - 1);
    el.innerHTML = plans.map((p, i) => planCardHtml(p, i === featuredIndex)).join('');
  }

  async function requireMemberSession(redirectTo = '/membership/login') {
    const res = await fetch('/api/membership/me');
    if (!res.ok) {
      window.location.href = redirectTo;
      return null;
    }
    return res.json();
  }

  function formatMoney(cents) {
    return '$' + (cents / 100).toFixed(2);
  }

  function formatDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function showAlert(el, message, type = 'error') {
    if (!el) return;
    el.textContent = message;
    el.className = `mp-alert mp-alert-${type} show`;
  }

  return { formatPrice, fetchPlans, planCardHtml, renderPricingGrid, requireMemberSession, formatMoney, formatDate, showAlert };
})();
