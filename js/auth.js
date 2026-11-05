import { sb, esc, toast, errMsg } from './core.js';

const shell = (inner) => `
  <main class="auth">
    <div class="auth-brand">
      <div class="auth-mark" aria-hidden="true">🍌</div>
      <h1>Banana<br>Traveller</h1>
      <p>Our trips, our people.</p>
    </div>
    <div class="auth-card">${inner}</div>
  </main>`;

export function renderNotConfigured(root) {
  root.innerHTML = shell(`
    <h2>Almost there</h2>
    <p class="muted">This app isn't connected to Supabase yet. Add your project URL and anon key to
    <code>config.js</code> in the banana-traveller repo, then redeploy.</p>`);
}

export function renderLogin(root, notice = '', mode = 'signin') {
  const isSignup = mode === 'signup';
  root.innerHTML = shell(`
    <div class="auth-switch" role="tablist">
      <button type="button" role="tab" data-mode="signin" class="${isSignup ? '' : 'on'}" aria-selected="${!isSignup}">Sign in</button>
      <button type="button" role="tab" data-mode="signup" class="${isSignup ? 'on' : ''}" aria-selected="${isSignup}">Create account</button>
    </div>
    ${notice ? `<p class="notice">${esc(notice)}</p>` : ''}
    ${isSignup ? `
      <form id="signup" class="stack">
        <label>Your name<input name="name" maxlength="40" autocomplete="name" required></label>
        <label>Email<input name="email" type="email" autocomplete="email" required></label>
        <label>Password<input name="password" type="password" minlength="8" autocomplete="new-password" required>
          <span class="muted small">At least 8 characters</span></label>
        <button class="btn btn-primary" type="submit">Create account</button>
      </form>` : `
      <form id="login" class="stack">
        <label>Email<input name="email" type="email" autocomplete="email" required></label>
        <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
        <button class="btn btn-primary" type="submit">Sign in</button>
      </form>
      <button class="link" id="forgot" type="button">Forgot password?</button>`}`);

  root.querySelector('.auth-switch').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (b && b.dataset.mode !== mode) renderLogin(root, '', b.dataset.mode);
  });

  if (isSignup) {
    const form = root.querySelector('#signup');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button');
      btn.disabled = true; btn.textContent = 'Creating account…';
      const email = form.email.value.trim();
      const { data, error } = await sb.auth.signUp({
        email,
        password: form.password.value,
        options: { data: { display_name: form.name.value.trim() }, emailRedirectTo: location.origin + '/' },
      });
      if (error) {
        toast(errMsg(error), 'error');
        btn.disabled = false; btn.textContent = 'Create account';
        return;
      }
      if (!data.session) {
        renderLogin(root, `Almost done! We sent a confirmation link to ${email}. Open it, then sign in here.`, 'signin');
      }
      // with a session, onAuthStateChange in app.js takes over
    });
    return;
  }

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
      const msg = error.message === 'Invalid login credentials' ? 'Email or password is wrong.'
        : /not confirmed/i.test(error.message) ? 'Please open the confirmation link in your email first.'
        : errMsg(error);
      toast(msg, 'error');
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

// Signed up but not approved yet
export function renderPending(root, { name, onCheck }) {
  root.innerHTML = shell(`
    <h2>Hi ${esc(name)}, you're nearly in</h2>
    <p class="muted">Your account is waiting for the admin to approve it. Once approved, you'll see the group's memories, events and chat.</p>
    <div class="stack" style="margin-top:16px">
      <button class="btn btn-primary" id="check" type="button">Check again</button>
      <button class="btn btn-ghost" id="out" type="button">Sign out</button>
    </div>`);
  root.querySelector('#check').addEventListener('click', onCheck);
  root.querySelector('#out').addEventListener('click', () => sb.auth.signOut());
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
