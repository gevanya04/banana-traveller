import {
  sb, me, isAdmin, esc, h, toast, errMsg, timeAgo, avatar, person,
  signedUrls, cachedUrl, openSheet, closeSheet, bus, MAX_UPLOAD_BYTES, BUCKET,
} from './core.js';

const REACTIONS = ['❤️', '😂', '🔥', '🍌'];
const PAGE = 15;

let view = { root: null, items: [], reactions: [], comments: [], tag: null, done: false, off: null };

export async function render(root) {
  view = { root, items: [], reactions: [], comments: [], tag: null, done: false, off: null };
  root.innerHTML = `
    <header class="page-head">
      <h1>Memories</h1>
      <button class="btn btn-primary btn-sm" id="add-memory" type="button">+ Add</button>
    </header>
    <div class="new-pill" id="new-pill" hidden><button type="button">New memories — show them</button></div>
    <div class="chips" id="tags"></div>
    <section id="list" class="feed"><p class="muted center pad">Loading…</p></section>
    <div class="center pad"><button class="btn btn-ghost" id="more" type="button" hidden>Load older</button></div>`;

  root.querySelector('#add-memory').addEventListener('click', openUpload);
  root.querySelector('#more').addEventListener('click', () => load(false));
  root.querySelector('#new-pill button').addEventListener('click', () => { root.querySelector('#new-pill').hidden = true; load(true); });
  root.querySelector('#list').addEventListener('click', onListClick);
  root.querySelector('#list').addEventListener('submit', onCommentSubmit);

  const onNew = (e) => { if (e.detail.author_id !== me()) root.querySelector('#new-pill').hidden = false; };
  bus.addEventListener('memory:new', onNew);
  view.off = () => bus.removeEventListener('memory:new', onNew);

  await Promise.all([load(true), loadTags()]);
  return () => view.off?.();
}

async function loadTags() {
  const { data } = await sb.from('memories').select('trip_tag').not('trip_tag', 'is', null).limit(500);
  const tags = [...new Set((data || []).map((r) => r.trip_tag))].sort();
  view.allTags = tags;
  const box = view.root.querySelector('#tags');
  if (!tags.length) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = [`<button type="button" class="chip ${view.tag ? '' : 'on'}" data-tag="">All trips</button>`,
    ...tags.map((t) => `<button type="button" class="chip ${view.tag === t ? 'on' : ''}" data-tag="${esc(t)}">${esc(t)}</button>`)].join('');
  box.onclick = (e) => {
    const b = e.target.closest('[data-tag]');
    if (!b) return;
    view.tag = b.dataset.tag || null;
    box.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === b));
    load(true);
  };
}

async function load(reset) {
  if (reset) { view.items = []; view.reactions = []; view.comments = []; view.done = false; }
  let q = sb.from('memories').select('*').order('created_at', { ascending: false }).limit(PAGE);
  if (view.tag) q = q.eq('trip_tag', view.tag);
  const last = view.items[view.items.length - 1];
  if (last) q = q.lt('created_at', last.created_at);
  const { data, error } = await q;
  if (error) { toast(errMsg(error), 'error'); return; }
  view.done = data.length < PAGE;

  const ids = data.map((m) => m.id);
  if (ids.length) {
    const [r, c] = await Promise.all([
      sb.from('memory_reactions').select('*').in('memory_id', ids),
      sb.from('memory_comments').select('*').in('memory_id', ids).order('created_at'),
      signedUrls(data.map((m) => m.media_path)),
    ]);
    view.reactions.push(...(r.data || []));
    view.comments.push(...(c.data || []));
  }
  view.items.push(...data);
  draw();
}

function draw() {
  const list = view.root.querySelector('#list');
  view.root.querySelector('#more').hidden = view.done;
  if (!view.items.length) {
    list.innerHTML = `
      <div class="empty">
        <p class="empty-title">No memories yet</p>
        <p class="muted">Share the first photo or video from a trip.</p>
        <button class="btn btn-primary" type="button" data-act="upload">Add a memory</button>
      </div>`;
    return;
  }
  list.innerHTML = view.items.map(card).join('');
}

function card(m) {
  const author = person(m.author_id);
  const url = cachedUrl(m.media_path);
  const media = m.media_type === 'video'
    ? `<video src="${esc(url)}" controls playsinline preload="metadata"></video>`
    : `<img src="${esc(url)}" alt="${esc(m.caption || 'Trip photo')}" loading="lazy">`;
  const reacts = view.reactions.filter((r) => r.memory_id === m.id);
  const comments = view.comments.filter((c) => c.memory_id === m.id);
  const canDelete = m.author_id === me() || isAdmin();

  return `
  <article class="memory" data-id="${m.id}">
    <header class="memory-head">
      ${avatar(m.author_id, 36)}
      <div><strong>${esc(author.display_name)}</strong><span class="muted small"> · ${timeAgo(m.created_at)}</span></div>
      ${canDelete ? `<button class="icon-btn" data-act="delete" type="button" aria-label="Delete memory">✕</button>` : ''}
    </header>
    <div class="memory-media">
      ${media}
      ${m.trip_tag ? `<span class="sticker">${esc(m.trip_tag)}</span>` : ''}
    </div>
    ${m.caption ? `<p class="memory-caption">${esc(m.caption)}</p>` : ''}
    <div class="reacts">
      ${REACTIONS.map((e) => {
        const n = reacts.filter((r) => r.emoji === e).length;
        const mine = reacts.some((r) => r.emoji === e && r.user_id === me());
        return `<button type="button" class="react ${mine ? 'on' : ''}" data-act="react" data-emoji="${e}" aria-pressed="${mine}">${e}${n ? `<span>${n}</span>` : ''}</button>`;
      }).join('')}
      <button type="button" class="react react-comments" data-act="comments">💬<span>${comments.length || ''}</span></button>
    </div>
    <div class="comments" hidden>
      ${comments.map((c) => `
        <div class="comment">
          ${avatar(c.author_id, 26)}
          <p><strong>${esc(person(c.author_id).display_name)}</strong> ${esc(c.body)}</p>
          ${c.author_id === me() || isAdmin() ? `<button class="icon-btn sm" type="button" data-act="del-comment" data-cid="${c.id}" aria-label="Delete comment">✕</button>` : ''}
        </div>`).join('')}
      <form class="comment-form">
        <input name="body" maxlength="1000" placeholder="Add a comment" aria-label="Add a comment" required>
        <button class="btn btn-sm btn-primary" type="submit">Post</button>
      </form>
    </div>
  </article>`;
}

async function onListClick(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  if (btn.dataset.act === 'upload') return openUpload();
  const art = btn.closest('.memory');
  const id = art?.dataset.id;

  if (btn.dataset.act === 'comments') {
    const box = art.querySelector('.comments');
    box.hidden = !box.hidden;
    if (!box.hidden) box.querySelector('input').focus();
  }

  if (btn.dataset.act === 'react') {
    const emoji = btn.dataset.emoji;
    const mine = view.reactions.find((r) => r.memory_id === id && r.user_id === me() && r.emoji === emoji);
    if (mine) {
      view.reactions = view.reactions.filter((r) => r !== mine);
      await sb.from('memory_reactions').delete().match({ memory_id: id, user_id: me(), emoji });
    } else {
      const row = { memory_id: id, user_id: me(), emoji };
      view.reactions.push(row);
      const { error } = await sb.from('memory_reactions').insert(row);
      if (error) toast(errMsg(error), 'error');
    }
    redrawCard(id);
  }

  if (btn.dataset.act === 'del-comment') {
    const cid = btn.dataset.cid;
    const { error } = await sb.from('memory_comments').delete().eq('id', cid);
    if (error) return toast(errMsg(error), 'error');
    view.comments = view.comments.filter((c) => c.id !== cid);
    redrawCard(id, true);
  }

  if (btn.dataset.act === 'delete') {
    if (!confirm('Delete this memory for everyone?')) return;
    const m = view.items.find((x) => x.id === id);
    const { error } = await sb.from('memories').delete().eq('id', id);
    if (error) return toast(errMsg(error), 'error');
    await sb.storage.from(BUCKET).remove([m.media_path]);
    view.items = view.items.filter((x) => x.id !== id);
    draw();
    toast('Memory deleted.');
  }
}

async function onCommentSubmit(e) {
  if (!e.target.matches('.comment-form')) return;
  e.preventDefault();
  const form = e.target;
  const id = form.closest('.memory').dataset.id;
  const body = form.body.value.trim();
  if (!body) return;
  const { data, error } = await sb.from('memory_comments')
    .insert({ memory_id: id, author_id: me(), body }).select().single();
  if (error) return toast(errMsg(error), 'error');
  view.comments.push(data);
  redrawCard(id, true);
}

function redrawCard(id, keepCommentsOpen = false) {
  const old = view.root.querySelector(`.memory[data-id="${id}"]`);
  const m = view.items.find((x) => x.id === id);
  if (!old || !m) return;
  const wasOpen = !old.querySelector('.comments').hidden;
  const fresh = h(card(m));
  if (wasOpen || keepCommentsOpen) fresh.querySelector('.comments').hidden = false;
  // keep the same media element so videos don't reload
  fresh.querySelector('.memory-media').replaceWith(old.querySelector('.memory-media'));
  old.replaceWith(fresh);
}

/* ---------- upload ---------- */
function openUpload() {
  const tags = view.allTags || [];
  const sheet = openSheet(`
    <h2>Add a memory</h2>
    <form id="upload" class="stack">
      <label class="drop">
        <input name="file" type="file" accept="image/*,video/*" required>
        <span class="drop-text">Choose a photo or video<br><span class="muted small">Up to 50 MB</span></span>
        <div class="drop-preview"></div>
      </label>
      <label>Caption<textarea name="caption" rows="2" maxlength="500" placeholder="What happened here?"></textarea></label>
      <label>Trip<input name="trip" list="trip-tags" maxlength="40" placeholder="e.g. Bali 2026"></label>
      <datalist id="trip-tags">${tags.map((t) => `<option value="${esc(t)}">`).join('')}</datalist>
      <div class="row">
        <button class="btn btn-ghost" type="button" data-close>Cancel</button>
        <button class="btn btn-primary" type="submit">Share memory</button>
      </div>
    </form>`);

  const form = sheet.querySelector('#upload');
  form.file.addEventListener('change', () => {
    const f = form.file.files[0];
    const prev = form.querySelector('.drop-preview');
    prev.innerHTML = '';
    if (!f) return;
    if (f.size > MAX_UPLOAD_BYTES) {
      toast(`That file is ${(f.size / 1048576).toFixed(0)} MB. The limit is 50 MB — trim or compress it first.`, 'error');
      form.file.value = '';
      return;
    }
    const url = URL.createObjectURL(f);
    prev.append(f.type.startsWith('video') ? h(`<video src="${url}" muted playsinline></video>`) : h(`<img src="${url}" alt="">`));
    form.querySelector('.drop-text').hidden = true;
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = form.file.files[0];
    if (!f) return;
    const isVideo = f.type.startsWith('video');
    const ext = (f.name.split('.').pop() || (isVideo ? 'mp4' : 'jpg')).toLowerCase().replace(/[^a-z0-9]/g, '');
    const path = `${me()}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true; btn.textContent = 'Uploading…';

    const up = await sb.storage.from(BUCKET).upload(path, f, { contentType: f.type, upsert: false });
    if (up.error) { toast(errMsg(up.error), 'error'); btn.disabled = false; btn.textContent = 'Share memory'; return; }

    const { error } = await sb.from('memories').insert({
      author_id: me(),
      caption: form.caption.value.trim() || null,
      trip_tag: form.trip.value.trim() || null,
      media_path: path,
      media_type: isVideo ? 'video' : 'image',
    });
    if (error) {
      await sb.storage.from(BUCKET).remove([path]);
      toast(errMsg(error), 'error'); btn.disabled = false; btn.textContent = 'Share memory'; return;
    }
    closeSheet();
    toast('Memory shared.');
    view.tag = null;
    await Promise.all([load(true), loadTags()]);
  });
}

