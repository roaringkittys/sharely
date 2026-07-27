/* Membership admin dashboard logic — lazy-initialised by calling window.initAdmin() */

window.initAdmin = function () {
  // Tab switching — scoped to #adminSection so member dashboard tabs are unaffected
  const tabs = document.querySelectorAll('#adminSection .mp-tab');
  const panels = document.querySelectorAll('#adminSection .mp-tab-panel');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
    });
  });

  let allProducts = [];

  async function loadOverview() {
    const res = await fetch('/api/membership/admin/overview');
    if (res.status === 401) { window.location.href = '/login'; return; }
    const data = await res.json();
    document.getElementById('statMembers').textContent = data.memberCount;
    document.getElementById('statActiveSubs').textContent = data.activeSubCount;
    document.getElementById('statMrr').textContent = MembershipUI.formatMoney(data.mrrCents);
    document.getElementById('statRevenue').textContent = MembershipUI.formatMoney(data.totalRevenueCents);
  }

  async function loadPlans() {
    const res = await fetch('/api/membership/admin/plans');
    const plans = await res.json();
    const rows = document.getElementById('plansRows');
    rows.innerHTML = plans.map(p => `
      <tr>
        <td>${p.name}</td>
        <td>${MembershipUI.formatMoney(p.price_cents)}</td>
        <td>${p.billing_interval} / ${p.duration_days || 30}d</td>
        <td><span class="mp-badge ${p.active ? 'mp-badge-active' : 'mp-badge-suspended'}">${p.active ? 'Active' : 'Inactive'}</span></td>
        <td><button class="mp-btn mp-btn-ghost mp-btn-sm" onclick="AdminUI.editPlanProducts(${p.id})">Manage tools</button></td>
        <td>
          <button class="mp-btn mp-btn-ghost mp-btn-sm" onclick="AdminUI.editPlan(${p.id})">Edit</button>
          <button class="mp-btn mp-btn-danger mp-btn-sm" onclick="AdminUI.deletePlan(${p.id})">Delete</button>
        </td>
      </tr>
    `).join('');
    window.__plans = plans;
  }

  async function loadProducts() {
    const res = await fetch('/api/membership/admin/products');
    const products = await res.json();
    allProducts = products;
    const rows = document.getElementById('productsRows');
    rows.innerHTML = products.map(p => `
      <tr>
        <td style="font-size:20px;">${p.icon}</td>
        <td>${p.name}</td>
        <td>${p.category}</td>
        <td><span class="mp-badge ${p.active ? 'mp-badge-active' : 'mp-badge-suspended'}">${p.active ? 'Active' : 'Inactive'}</span></td>
        <td>
          <button class="mp-btn mp-btn-ghost mp-btn-sm" onclick="AdminUI.editProduct(${p.id})">Edit</button>
          <button class="mp-btn mp-btn-danger mp-btn-sm" onclick="AdminUI.deleteProduct(${p.id})">Delete</button>
        </td>
      </tr>
    `).join('');
  }

  async function loadMembers() {
    const res = await fetch('/api/membership/admin/members');
    const members = await res.json();
    const rows = document.getElementById('membersRows');
    rows.innerHTML = members.map(m => `
      <tr>
        <td>${m.name}</td>
        <td>${m.email}</td>
        <td>${m.plan_name || '—'}</td>
        <td><span class="mp-badge mp-badge-${m.status}">${m.status}</span></td>
        <td>${MembershipUI.formatDate(m.created_at)}</td>
        <td>
          ${m.status === 'active'
            ? `<button class="mp-btn mp-btn-danger mp-btn-sm" onclick="AdminUI.setMemberStatus(${m.id}, 'suspended')">Suspend</button>`
            : `<button class="mp-btn mp-btn-ghost mp-btn-sm" onclick="AdminUI.setMemberStatus(${m.id}, 'active')">Reactivate</button>`}
        </td>
      </tr>
    `).join('');
  }

  async function loadSubscriptions() {
    const res = await fetch('/api/membership/admin/subscriptions');
    const subs = await res.json();
    const rows = document.getElementById('subscriptionsRows');
    rows.innerHTML = subs.map(s => `
      <tr>
        <td>${s.member_name} <span style="color:var(--mp-text-faint);">(${s.member_email})</span></td>
        <td>${s.plan_name}</td>
        <td><span class="mp-badge mp-badge-${s.status}">${s.status}</span></td>
        <td>${MembershipUI.formatDate(s.current_period_end)}</td>
      </tr>
    `).join('');
  }

  async function loadBilling() {
    const res = await fetch('/api/membership/admin/billing');
    const records = await res.json();
    const rows = document.getElementById('billingRows');
    rows.innerHTML = records.map(r => `
      <tr>
        <td>${MembershipUI.formatDate(r.created_at)}</td>
        <td>${r.member_email}</td>
        <td>${MembershipUI.formatMoney(r.amount_cents)}</td>
        <td><span class="mp-badge mp-badge-${r.status}">${r.status}</span></td>
        <td>${r.provider_ref || '—'}</td>
      </tr>
    `).join('');
  }

  function refreshAll() {
    loadOverview();
    loadPlans();
    loadProducts();
    loadMembers();
    loadSubscriptions();
    loadBilling();
  }

  // ── Plan modal — all IDs prefixed with "adm" to avoid collisions ──────
  const planModal = document.getElementById('planModal');
  document.getElementById('admNewPlanBtn').addEventListener('click', () => openPlanModal());
  document.getElementById('admCancelPlanBtn').addEventListener('click', () => planModal.classList.add('mp-hidden'));

  function openPlanModal(plan) {
    document.getElementById('admPlanModalTitle').textContent = plan ? 'Edit plan' : 'New plan';
    document.getElementById('admPlanId').value = plan ? plan.id : '';
    document.getElementById('admPlanName').value = plan ? plan.name : '';
    document.getElementById('admPlanDesc').value = plan ? plan.description : '';
    document.getElementById('admPlanPrice').value = plan ? plan.price_cents : '';
    document.getElementById('admPlanInterval').value = plan ? plan.billing_interval : 'day';
    document.getElementById('admPlanDuration').value = plan ? (plan.duration_days || 30) : 30;
    document.getElementById('admPlanFeatures').value = plan ? (plan.features || []).join('\n') : '';
    planModal.classList.remove('mp-hidden');
  }

  document.getElementById('admSavePlanBtn').addEventListener('click', async () => {
    const id = document.getElementById('admPlanId').value;
    const payload = {
      name: document.getElementById('admPlanName').value,
      description: document.getElementById('admPlanDesc').value,
      price_cents: parseInt(document.getElementById('admPlanPrice').value || '0', 10),
      billing_interval: document.getElementById('admPlanInterval').value,
      duration_days: parseInt(document.getElementById('admPlanDuration').value || '30', 10),
      features: document.getElementById('admPlanFeatures').value.split('\n').map(s => s.trim()).filter(Boolean),
      active: true,
    };
    const url = id ? `/api/membership/admin/plans/${id}` : '/api/membership/admin/plans';
    await fetch(url, {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    planModal.classList.add('mp-hidden');
    loadPlans();
  });

  // ── Product modal ─────────────────────────────────────────────────────
  const productModal = document.getElementById('productModal');
  document.getElementById('admNewProductBtn').addEventListener('click', () => openProductModal());
  document.getElementById('admCancelProductBtn').addEventListener('click', () => productModal.classList.add('mp-hidden'));

  function openProductModal(product) {
    document.getElementById('admProductModalTitle').textContent = product ? 'Edit tool' : 'New tool';
    document.getElementById('admProductId').value = product ? product.id : '';
    document.getElementById('admProductName').value = product ? product.name : '';
    document.getElementById('admProductDesc').value = product ? product.description : '';
    document.getElementById('admProductIcon').value = product ? product.icon : '';
    document.getElementById('admProductCat').value = product ? product.category : '';
    productModal.classList.remove('mp-hidden');
  }

  document.getElementById('admSaveProductBtn').addEventListener('click', async () => {
    const id = document.getElementById('admProductId').value;
    const payload = {
      name: document.getElementById('admProductName').value,
      description: document.getElementById('admProductDesc').value,
      icon: document.getElementById('admProductIcon').value || '🧰',
      category: document.getElementById('admProductCat').value || 'general',
      active: true,
    };
    const url = id ? `/api/membership/admin/products/${id}` : '/api/membership/admin/products';
    await fetch(url, {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    productModal.classList.add('mp-hidden');
    loadProducts();
  });

  window.AdminUI = {
    editPlan(id) {
      const plan = (window.__plans || []).find(p => p.id === id);
      openPlanModal(plan);
    },
    async deletePlan(id) {
      if (!confirm('Delete this plan? This cannot be undone.')) return;
      await fetch(`/api/membership/admin/plans/${id}`, { method: 'DELETE' });
      loadPlans();
    },
    async editPlanProducts(planId) {
      const res = await fetch(`/api/membership/admin/plans/${planId}/products`);
      const selectedIds = await res.json();
      const names = allProducts
        .map(p => `${selectedIds.includes(p.id) ? '[x]' : '[ ]'} ${p.id}: ${p.name}`)
        .join('\n');
      const input = prompt(
        `Enter comma-separated tool IDs to include in this plan:\n\n${names}`,
        selectedIds.join(',')
      );
      if (input === null) return;
      const ids = input.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
      await fetch(`/api/membership/admin/plans/${planId}/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_ids: ids }),
      });
      loadPlans();
    },
    editProduct(id) {
      const product = allProducts.find(p => p.id === id);
      openProductModal(product);
    },
    async deleteProduct(id) {
      if (!confirm('Delete this tool? This cannot be undone.')) return;
      await fetch(`/api/membership/admin/products/${id}`, { method: 'DELETE' });
      loadProducts();
    },
    async setMemberStatus(id, status) {
      await fetch(`/api/membership/admin/members/${id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      loadMembers();
    },
  };

  refreshAll();
};
