import { sb, state, me, isAdmin, esc, toast, errMsg, timeAgo, avatar, person, bus, setBadge } from './core.js';

/* Unread tracking: last time this device opened each conversation */
const readKey = (conv) => `bt:read:${me()}:${conv}`;
const lastRead = (conv) => { try { return localStorage.getItem(readKey(conv)) || ''; } catch { return ''; } };
const markRead = (conv) => { try { localStorage.setItem(readKey(conv), new Date().toISOString()); } catch { /* storage blocked */ } };

export const convOf = (m) => (m.recipient_id ? (m.sender_id === me() ? m.recipient_id : m.sender_id) : 'group');

export async function hasUnread() {
  const { data } = await sb.from('messages').select('sender_id,recipient_id,created_at')
    .neq('sender_id', me()).order('created_at', { ascending: false }).limit(200);
  return (data || []).some((m) => m.created_at > lastRead(convOf(m)));
}

export async function render(root, param) {
  return param ? renderThread(root, param) : renderList(root);
}

/* ---------- conversation list ---------- */
async function renderList(root) {
  root.innerHTML = `
    <header class="page-head"><h1>Chat</h1></header>
    <section id="convs" class="convs"><p class="muted center pad">Loading…</p></section>`;

  const draw = async () => {
    const { data, error } = await sb.from('messages').select('*')
      .order('created_at', { ascending: false }).limit(400);
    if (error) return toast(errMsg(error), 'error');
    const latest = new Map();
    for (const m of data) { const c = convOf(m); if (!latest.has(c)) latest.set(c, m); }

    const friends = [...state.profiles.values()].filter((p) => p.id !== me());
    friends.sort((a, b) => (latest.get(b.id)?.created_at || '').localeCompare(latest.get(a.id)?.created_at || '')
      || a.display_name.localeCompare(b.display_name));

    const row = (conv, title, icon) => {
      const m = latest.get(conv);
      const unread = m && m.sender_id !== me() && m.created_at > lastRead(conv);
      const preview = m ? `${m.sender_id === me() ? 'You: ' : (conv === 'group' ? person(m.sender_id).display_name + ': ' : '')}${m.body}` : 'No messages yet';
      return `
        <a class="conv ${unread ? 'unread' : ''}" href="#chat/${conv}">
          ${icon}
          <div class="conv-text"><strong>${esc(title)}</strong><span class="muted">${esc(preview)}</span></div>
          ${m ? `<span class="muted small">${timeAgo(m.created_at)}</span>` : ''}
          ${unread ? '<i class="dot" aria-label="Unread"></i>' : ''}
        </a>`;
    };

    root.querySelector('#convs').innerHTML =
      row('group', 'Squad chat', `<span class="avatar avatar-group" style="width:44px;height:44px">🍌</span>`) +
      (friends.length ? `<p class="list-label">Direct messages</p>` : '') +
      friends.map((f) => row(f.id, f.display_name, avatar(f.id, 44))).join('');
  };

  await draw();
  const onMsg = () => draw();
  bus.addEventListener('message:new', onMsg);
  return () => bus.removeEventListener('message:new', onMsg);
}

/* ---------- a single conversation ---------- */
async function renderThread(root, conv) {
  const isGroup = conv === 'group';
  if (!isGroup && !state.profiles.has(conv)) { location.hash = '#chat'; return; }
  const title = isGroup ? 'Squad chat' : person(conv).display_name;

  root.innerHTML = `
    <div class="thread">
      <header class="thread-head">
        <a href="#chat" class="icon-btn" aria-label="Back to chats">‹</a>
        ${isGroup ? `<span class="avatar avatar-group" style="width:34px;height:34px">🍌</span>` : avatar(conv, 34)}
        <h1>${esc(title)}</h1>
      </header>
      <div class="bubbles" id="bubbles"><p class="muted center pad">Loading…</p></div>
      <form class="composer" id="composer">
        <textarea name="body" rows="1" maxlength="2000" placeholder="Message ${esc(title)}" aria-label="Message" required></textarea>
        <button class="btn btn-primary" type="submit">Send</button>
      </form>
    </div>`;

  const box = root.querySelector('#bubbles');
  let messages = [];

  let q = sb.from('messages').select('*').order('created_at', { ascending: false }).limit(150);
  q = isGroup
    ? q.is('recipient_id', null)
    : q.or(`and(sender_id.eq.${me()},recipient_id.eq.${conv}),and(sender_id.eq.${conv},recipient_id.eq.${me()})`);
  const { data, error } = await q;
  if (error) { toast(errMsg(error), 'error'); return; }
  messages = data.reverse();

  const bubble = (m, prev) => {
    const mine = m.sender_id === me();
    const showName = isGroup && !mine && prev?.sender_id !== m.sender_id;
    const canDelete = mine || (isGroup && isAdmin());
    return `
      <div class="bubble-row ${mine ? 'mine' : ''}" data-id="${m.id}">
        ${!mine && isGroup ? (prev?.sender_id !== m.sender_id ? avatar(m.sender_id, 28) : '<span class="avatar-gap"></span>') : ''}
        <div class="bubble" ${canDelete ? 'tabindex="0" data-can-delete' : ''}>
          ${showName ? `<b class="bubble-name">${esc(person(m.sender_id).display_name)}</b>` : ''}
          ${esc(m.body).replace(/\n/g, '<br>')}
          <time>${timeAgo(m.created_at)}</time>
          ${canDelete ? `<button type="button" class="bubble-del" data-act="del">Delete</button>` : ''}
        </div>
      </div>`;
  };

  const draw = () => {
    box.innerHTML = messages.length
      ? messages.map((m, i) => bubble(m, messages[i - 1])).join('')
      : `<div class="empty"><p class="muted">${isGroup ? 'Say hi to the squad.' : `Start a private chat with ${esc(title)}.`}</p></div>`;
    box.scrollTop = box.scrollHeight;
    markRead(conv);
    hasUnread().then((u) => setBadge('chat', u));
  };
  draw();

  box.addEventListener('click', async (e) => {
    const del = e.target.closest('[data-act="del"]');
    if (del) {
      const id = del.closest('.bubble-row').dataset.id;
      if (!confirm('Delete this message?')) return;
      const { error: err } = await sb.from('messages').delete().eq('id', id);
      if (err) return toast(errMsg(err), 'error');
      messages = messages.filter((m) => m.id !== id);
      draw();
      return;
    }
    const b = e.target.closest('[data-can-delete]');
    if (b) b.classList.toggle('show-del');
  });

  const form = root.querySelector('#composer');
  const ta = form.body;
  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !matchMedia('(pointer: coarse)').matches) { e.preventDefault(); form.requestSubmit(); }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = ta.value.trim();
    if (!body) return;
    ta.value = ''; ta.style.height = 'auto';
    const { data: sent, error: err } = await sb.from('messages')
      .insert({ sender_id: me(), recipient_id: isGroup ? null : conv, body }).select().single();
    if (err) { ta.value = body; return toast(errMsg(err), 'error'); }
    if (!messages.some((m) => m.id === sent.id)) { messages.push(sent); draw(); }
  });

  const onMsg = (e) => {
    const m = e.detail;
    if (convOf(m) !== conv || messages.some((x) => x.id === m.id)) return;
    messages.push(m);
    draw();
  };
  const onDel = (e) => {
    if (!messages.some((x) => x.id === e.detail.id)) return;
    messages = messages.filter((x) => x.id !== e.detail.id);
    draw();
  };
  bus.addEventListener('message:new', onMsg);
  bus.addEventListener('message:deleted', onDel);
  return () => {
    bus.removeEventListener('message:new', onMsg);
    bus.removeEventListener('message:deleted', onDel);
  };
}
