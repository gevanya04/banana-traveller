import { sb, state, me, esc, toast, errMsg, timeAgo, avatar, person, bus, setBadge } from './core.js';

const POKE_COOLDOWN_MS = 30 * 1000;
const lastPoke = new Map();

export async function unseenPokes() {
  const { count } = await sb.from('pokes').select('id', { count: 'exact', head: true })
    .eq('to_id', me()).eq('seen', false);
  return count || 0;
}

export async function render(root) {
  root.innerHTML = `
    <header class="page-head"><h1>Friends</h1></header>
    <section id="pokes"></section>
    <section id="people" class="people"></section>`;

  const draw = async () => {
    const { data: pokes } = await sb.from('pokes').select('*')
      .eq('to_id', me()).order('created_at', { ascending: false }).limit(30);
    const fresh = (pokes || []).filter((p) => !p.seen);
    const recent = (pokes || []).slice(0, 8);

    root.querySelector('#pokes').innerHTML = recent.length ? `
      <div class="poke-box ${fresh.length ? 'has-new' : ''}">
        <p class="poke-box-title">${fresh.length ? `${fresh.length} new poke${fresh.length > 1 ? 's' : ''}` : 'Recent pokes'}</p>
        ${recent.map((p) => `
          <div class="poke-row ${p.seen ? '' : 'new'}">
            ${avatar(p.from_id, 32)}
            <p><strong>${esc(person(p.from_id).display_name)}</strong> poked you <span class="muted small">${timeAgo(p.created_at)}</span></p>
            <button class="btn btn-sm btn-poke" type="button" data-poke="${p.from_id}">Poke back</button>
          </div>`).join('')}
      </div>` : '';

    const friends = [...state.profiles.values()].filter((p) => p.id !== me());
    root.querySelector('#people').innerHTML = friends.length
      ? friends.map((f) => `
        <div class="friend">
          ${avatar(f.id, 48)}
          <div class="friend-name"><strong>${esc(f.display_name)}</strong>${f.role === 'admin' ? '<span class="tag">Admin</span>' : ''}</div>
          <button class="btn btn-sm btn-poke" type="button" data-poke="${f.id}">👉 Poke</button>
          <a class="btn btn-sm btn-ghost" href="#chat/${f.id}">Message</a>
        </div>`).join('')
      : `<div class="empty"><p class="empty-title">It's just you so far</p><p class="muted">Invite friends from the Me tab (admin only).</p></div>`;

    if (fresh.length) {
      await sb.from('pokes').update({ seen: true }).eq('to_id', me()).eq('seen', false);
      setBadge('friends', false);
    }
  };

  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-poke]');
    if (!b) return;
    const to = b.dataset.poke;
    if (Date.now() - (lastPoke.get(to) || 0) < POKE_COOLDOWN_MS) {
      return toast(`You just poked ${person(to).display_name}. Give it a moment.`);
    }
    b.disabled = true;
    const { error } = await sb.from('pokes').insert({ from_id: me(), to_id: to });
    b.disabled = false;
    if (error) return toast(errMsg(error), 'error');
    lastPoke.set(to, Date.now());
    b.classList.add('poked');
    setTimeout(() => b.classList.remove('poked'), 600);
    toast(`You poked ${person(to).display_name}.`);
  });

  await draw();
  const onPoke = () => draw();
  bus.addEventListener('poke:new', onPoke);
  return () => bus.removeEventListener('poke:new', onPoke);
}
