(async function () {
  const loadingEl = document.getElementById('login-loading');
  const configErrorEl = document.getElementById('login-config-error');
  const cardEl = document.getElementById('login-card');

  if (adminConfigMissing()) {
    loadingEl.style.display = 'none';
    configErrorEl.style.display = 'flex';
    return;
  }

  // Already signed in from a previous visit? Skip straight to the dashboard.
  const session = await getAdminSession();
  if (session) {
    redirectToDashboard();
    return;
  }

  loadingEl.style.display = 'none';
  cardEl.style.display = 'block';

  const form = document.getElementById('login-form');
  const emailInput = document.getElementById('login-email');
  const passwordInput = document.getElementById('login-password');
  const errorEl = document.getElementById('login-error');
  const submitBtn = document.getElementById('login-submit');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.style.display = 'none';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing In…';

    const { error } = await supabaseClient.auth.signInWithPassword({
      email: emailInput.value.trim(),
      password: passwordInput.value,
    });

    if (error) {
      errorEl.textContent = 'Invalid email or password.';
      errorEl.style.display = 'block';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign In';
      return;
    }

    redirectToDashboard();
  });
})();
