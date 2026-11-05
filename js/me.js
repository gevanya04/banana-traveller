import { sb, state, me, isAdmin, esc, toast, errMsg, avatar, loadProfiles, BUCKET } from './core.js';

const MAX_AVATAR = 5 * 1024 * 1024;

async function callAdminApi(path, body) {
  const { data: { session } } = await sb.auth.getSession();
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

export async function render(root) {
  const draw = () => {
    const p = state.profile;
    const members = [...state.profiles.values()];
    root.innerHTML = `
      <header class="page-head"><h1>Me</h1></header>

      <section class="panel">
        <div class="me-top">
          <label class="avatar-edit" title="Change photo">
            ${avatar(me(), 72)}
            <input type="file" accept="image/*" id="avatar-file" hidden>
            <span class="avatar-edit-hint">Change photo</span>
          </label>
          <div>
            <p class="me-name">${esc(p.display_name)}</p>
            <p class="muted small">${esc(p.email)}${isAdmin() ? ' · Admin' : ''}</p>
          </div>
        </div>
        <form id="name-form" class="inline-form">
          <label class="grow">Display name<input name="name" maxlength="40" required value="${esc(p.display_name)}"></label>
          <button class="btn btn-ghost" type="submit">Save name</button>
        </form>
      </section>

      <section class="panel">
        <h2>Password</h2>
        <form id="pw-form" class="inline-form">
          <label class="grow">New password<input name="pw" type="password" minlength="8" autocomplete="new-password" required></label>
          <button class="btn btn-ghost" type="submit">Change password</button>
        </form>
      </section>

      ${isAdmin() ? `
      <section class="panel panel-admin">
        <h2>Admin</h2>
        <p class="muted small">Only people you invite can join. They'll get an email to set their password.</p>
        <form id="invite-form" class="inline-form">
          <label class="grow">Friend's email<input name="email" type="email" required placeholder="friend@email.com"></label>
          <button class="btn btn-primary" type="submit">Send invite</button>
        </form>
        <p class="list-label">Members (${members.length})</p>
        <div class="members">
          ${members.map((m) => `
            <div class="member">
              ${avatar(m.id, 34)}
              <div class="grow"><strong>${esc(m.display_name)}</strong><span class="muted small">${esc(m.email)}</span></div>
              ${m.id === me() ? '<span class="tag">You</span>'
                : `<button class="btn btn-sm btn-ghost danger" type="button" data-remove="${m.id}">Remove</button>`}
            </div>`).join('')}
        </div>
      </section>` : ''}

      <div class="center pad"><button class="btn btn-ghost" id="signout" type="button">Sign out</button></div>`;
    wire();
  };

  const wire = () => {
    root.querySelector('#avatar-file').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      if (f.size > MAX_AVATAR) return toast('Profile photos must be under 5 MB.', 'error');
      const ext = (f.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
      const path = `${me()}/avatar-${Date.now()}.${ext}`;
      const old = state.profile.avatar_path;
      const up = await sb.storage.from(BUCKET).upload(path, f, { contentType: f.type });
      if (up.error) return toast(errMsg(up.error), 'error');
      const { error } = await sb.from('profiles').update({ avatar_path: path }).eq('id', me());
      if (error) return toast(errMsg(error), 'error');
      if (old) sb.storage.from(BUCKET).remove([old]);
      await loadProfiles();
      toast('Photo updated.');
      draw();
    });

    root.querySelector('#name-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = e.target.name.value.trim();
      const { error } = await sb.from('profiles').update({ display_name: name }).eq('id', me());
      if (error) return toast(errMsg(error), 'error');
      await loadProfiles();
      toast('Name saved.');
      draw();
    });

    root.querySelector('#pw-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const { error } = await sb.auth.updateUser({ password: e.target.pw.value });
      if (error) return toast(errMsg(error), 'error');
      e.target.reset();
      toast('Password changed.');
    });

    root.querySelector('#signout').addEventListener('click', () => sb.auth.signOut());

    if (!isAdmin()) return;

    root.querySelector('#invite-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button');
      const email = e.target.email.value.trim();
      btn.disabled = true; btn.textContent = 'Sending…';
      try {
        await callAdminApi('/api/invite', { email });
        toast(`Invite sent to ${email}.`);
        e.target.reset();
      } catch (err) {
        toast(errMsg(err), 'error');
      }
      btn.disabled = false; btn.textContent = 'Send invite';
    });

    root.querySelector('.members').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-remove]');
      if (!b) return;
      const m = state.profiles.get(b.dataset.remove);
      if (!confirm(`Remove ${m.display_name}? Their account, memories, comments, messages and events will be deleted.`)) return;
      b.disabled = true;
      try {
        await callAdminApi('/api/remove-member', { userId: m.id });
        await loadProfiles();
        toast(`${m.display_name} removed.`);
        draw();
      } catch (err) {
        toast(errMsg(err), 'error');
        b.disabled = false;
      }
    });
  };

  draw();
}
