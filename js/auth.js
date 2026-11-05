import { sb, esc, toast, errMsg } from './core.js';

const shell = (inner) => `
  <main class="auth">
    <div class="auth-brand">
      <div class="auth-mark" aria-hidden="true">🍌</div>
      <h1>Banana<br>Traveller</h1>
      <p>Our trips, our people. Invite only.</p>
    </div>
    <div class="auth-card">${inner}</div>
  </main>`;

export function renderNotConfigured(root) {
  root.innerHTML = shell(`
    <h2>Almost there</h2>
    <p class="muted">This app isn't connected to Supabase yet. Add your project URL and anon key to
    <code>config.js</code> in the banana-traveller repo, then redeploy.</p>`);
}

export function renderLogin(root, notice = '') {
  root.innerHTML = shell(`
    <h2>Sign in</h2>
    ${notice ? `<p class="notice">${esc(notice)}</p>` : ''}
    <form id="login" class="stack">
      <label>Email<input name="email" type="email" autocomplete="email" required></label>
      <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
      <button class="btn btn-primary" type="submit">Sign in</button>
    </form>
    <button class="link" id="forgot" type="button">Forgot password?</button>
    <p class="muted small">No account? Ask the admin for an invite.</p>`);

  const form = root.querySelector('#login');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button');
    btn.disabled = true; btn.textContent = 'Signing in…';
    const { error } = await sb.auth.signInWithPassword({
      email: form.email.value.trim(),
      password: form.password.value,
    });
    if (error) {
      toast(error.message === 'Invalid login credentials' ? 'Email or password is wrong.' : errMsg(error), 'error');
      btn.disabled = false; btn.textContent = 'Sign in';
    }
    // success is handled by onAuthStateChange in app.js
  });

  root.querySelector('#forgot').addEventListener('click', async () => {
    const email = form.email.value.trim();
    if (!email) { toast('Type your email first, then tap Forgot password.', 'error'); form.email.focus(); return; }
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/' });
    if (error) toast(errMsg(error), 'error');
    else toast('Check your email for a reset link.');
  });
}

// Shown after opening an invite link (new member) or a reset link
export function renderSetPassword(root, { isInvite, currentName, onDone }) {
  root.innerHTML = shell(`
    <h2>${isInvite ? 'Welcome! Set up your account' : 'Choose a new password'}</h2>
    <form id="setpw" class="stack">
      ${isInvite ? `<label>Your name<input name="name" maxlength="40" required value="${esc(currentName || '')}"></label>` : ''}
      <label>New password<input name="pw" type="password" minlength="8" autocomplete="new-password" required></label>
      <label>Confirm password<input name="pw2" type="password" minlength="8" autocomplete="new-password" required></label>
      <button class="btn btn-primary" type="submit">${isInvite ? 'Join Banana Traveller' : 'Save password'}</button>
    </form>`);

  const form = root.querySelector('#setpw');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (form.pw.value !== form.pw2.value) { toast("Passwords don't match.", 'error'); return; }
    const btn = form.querySelector('button');
    btn.disabled = true;
    const { data, error } = await sb.auth.updateUser({ password: form.pw.value });
    if (error) { toast(errMsg(error), 'error'); btn.disabled = false; return; }
    if (isInvite && form.name) {
      await sb.from('profiles').update({ display_name: form.name.value.trim() }).eq('id', data.user.id);
    }
    toast(isInvite ? 'You’re in!' : 'Password saved.');
    onDone();
  });
}
