(function () {
  'use strict';
  const form = document.getElementById('loginForm'), err = document.getElementById('loginError'), btn = document.getElementById('loginBtn');
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); err.hidden = true; btn.disabled = true;
    try {
      const res = await fetch('/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: form.password.value }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Login failed');
      location.replace('/admin');
    } catch (ex) { err.textContent = ex.message; err.hidden = false; form.password.select(); }
    finally { btn.disabled = false; }
  });
})();
