const params = new URLSearchParams(location.search);
const orderId = params.get('order_id');
const email = params.get('email') || '';
const isPending = params.get('pending');

document.getElementById('emailInput').value = email;

async function checkTransaction() {
  try {
    const res = await fetch('/api/membership/transaction/' + encodeURIComponent(orderId));
    if (!res.ok) throw new Error('Transaction check failed');
    const data = await res.json();

    if (data.status === 'paid') {
      const meRes = await fetch('/api/membership/me');
      if (meRes.ok) {
        document.getElementById('successCard').style.display = 'none';
        document.getElementById('existingMemberCard').style.display = 'block';
        return;
      }
    } else if (data.status === 'pending' && isPending) {
      document.querySelector('.mp-auth-sub').textContent = 'Your payment is being processed. We will activate your subscription once it is confirmed.';
      document.getElementById('createAccountForm').style.display = 'none';
    } else if (data.status === 'failed') {
      window.location.href = '/membership/checkout/failed';
    }
  } catch (err) {
    console.error(err);
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

if (orderId) checkTransaction();
