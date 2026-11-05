import { sb, me, isAdmin, esc, toast, errMsg, avatar, person, openSheet, closeSheet } from './core.js';

let view = { root: null, events: [], past: false };

export async function render(root) {
  view = { root, events: [], past: false };
  root.innerHTML = `
    <header class="page-head">
      <h1>Events</h1>
      <button class="btn btn-primary btn-sm" id="add-event" type="button">+ New</button>
    </header>
    <div class="seg" role="tablist">
      <button type="button" class="on" data-when="upcoming" role="tab" aria-selected="true">Upcoming</button>
      <button type="button" data-when="past" role="tab" aria-selected="false">Past</button>
    </div>
    <section id="events" class="events"><p class="muted center pad">Loading…</p></section>`;

  root.querySelector('#add-event').addEventListener('click', () => openForm());
  root.querySelector('.seg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-when]');
    if (!b) return;
    view.past = b.dataset.when === 'past';
    root.querySelectorAll('.seg button').forEach((x) => {
      x.classList.toggle('on', x === b); x.setAttribute('aria-selected', x === b);
    });
    load();
  });
  root.querySelector('#events').addEventListener('click', onClick);
  await load();
}

async function load() {
  const now = new Date().toISOString();
  let q = sb.from('events').select('*');
  q = view.past
    ? q.lt('ends_at', now).order('starts_at', { ascending: false }).limit(50)
    : q.gte('ends_at', now).order('starts_at', { ascending: true }).limit(100);
  const { data, error } = await q;
  if (error) return toast(errMsg(error), 'error');
  view.events = data;
  draw();
}

function draw() {
  const list = view.root.querySelector('#events');
  if (!view.events.length) {
    list.innerHTML = view.past
      ? `<div class="empty"><p class="empty-title">No past events</p><p class="muted">Finished plans will show up here.</p></div>`
      : `<div class="empty"><p class="empty-title">Nothing planned yet</p><p class="muted">Add the next trip, dinner or meet-up.</p>
         <button class="btn btn-primary" type="button" data-act="new">Plan an event</button></div>`;
    return;
  }
  list.innerHTML = view.events.map(card).join('');
}

const dayFmt = (d) => d.toLocaleDateString(undefined, { day: 'numeric' });
const monFmt = (d) => d.toLocaleDateString(undefined, { month: 'short' });
const timeFmt = (d) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const longDate = (d) => d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

function whenText(s, e) {
  const sameDay = s.toDateString() === e.toDateString();
  return sameDay
    ? `${longDate(s)}, ${timeFmt(s)} – ${timeFmt(e)}`
    : `${longDate(s)}, ${timeFmt(s)} – ${longDate(e)}, ${timeFmt(e)}`;
}

export function googleCalendarLink(ev) {
  const fmt = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: ev.title,
    dates: `${fmt(ev.starts_at)}/${fmt(ev.ends_at)}`,
    details: [ev.notes, 'Planned on Banana Traveller'].filter(Boolean).join('\n\n'),
    location: ev.location || '',
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

function card(ev) {
  const s = new Date(ev.starts_at), e = new Date(ev.ends_at);
  const canEdit = ev.created_by === me() || isAdmin();
  return `
  <article class="event" data-id="${ev.id}">
    <div class="event-date" aria-hidden="true"><b>${dayFmt(s)}</b><span>${monFmt(s)}</span></div>
    <div class="event-body">
      <h3>${esc(ev.title)}</h3>
      <p class="event-when">${esc(whenText(s, e))}</p>
      ${ev.location ? `<p class="event-where">📍 ${esc(ev.location)}</p>` : ''}
      ${ev.notes ? `<p class="event-notes">${esc(ev.notes)}</p>` : ''}
      <div class="event-by">${avatar(ev.created_by, 22)}<span class="muted small">Added by ${esc(person(ev.created_by).display_name)}</span></div>
      <div class="event-actions">
        <a class="btn btn-gcal btn-sm" href="${esc(googleCalendarLink(ev))}" target="_blank" rel="noopener">Add to Google Calendar</a>
        ${canEdit ? `<button class="btn btn-ghost btn-sm" type="button" data-act="edit">Edit</button>
                     <button class="btn btn-ghost btn-sm danger" type="button" data-act="delete">Delete</button>` : ''}
      </div>
    </div>
  </article>`;
}

async function onClick(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  if (btn.dataset.act === 'new') return openForm();
  const id = btn.closest('.event').dataset.id;
  const ev = view.events.find((x) => x.id === id);
  if (btn.dataset.act === 'edit') openForm(ev);
  if (btn.dataset.act === 'delete') {
    if (!confirm(`Delete "${ev.title}"?`)) return;
    const { error } = await sb.from('events').delete().eq('id', id);
    if (error) return toast(errMsg(error), 'error');
    toast('Event deleted.');
    load();
  }
}

// <input type="datetime-local"> wants local time without a zone
const toLocalInput = (d) => {
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d - off).toISOString().slice(0, 16);
};

function openForm(ev = null) {
  const start = ev ? new Date(ev.starts_at) : (() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(19, 0, 0, 0); return d; })();
  const end = ev ? new Date(ev.ends_at) : new Date(start.getTime() + 2 * 3600000);
  const sheet = openSheet(`
    <h2>${ev ? 'Edit event' : 'New event'}</h2>
    <form id="event-form" class="stack">
      <label>Title<input name="title" maxlength="120" required value="${esc(ev?.title || '')}" placeholder="e.g. Flight to Bali"></label>
      <div class="row2">
        <label>Starts<input name="start" type="datetime-local" required value="${toLocalInput(start)}"></label>
        <label>Ends<input name="end" type="datetime-local" required value="${toLocalInput(end)}"></label>
      </div>
      <label>Location<input name="location" maxlength="200" value="${esc(ev?.location || '')}" placeholder="Optional"></label>
      <label>Notes<textarea name="notes" rows="3" maxlength="2000" placeholder="Optional">${esc(ev?.notes || '')}</textarea></label>
      <div class="row">
        <button class="btn btn-ghost" type="button" data-close>Cancel</button>
        <button class="btn btn-primary" type="submit">${ev ? 'Save changes' : 'Create event'}</button>
      </div>
    </form>`);

  const form = sheet.querySelector('#event-form');
  form.start.addEventListener('change', () => {
    if (new Date(form.end.value) < new Date(form.start.value)) {
      form.end.value = toLocalInput(new Date(new Date(form.start.value).getTime() + 2 * 3600000));
    }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const s = new Date(form.start.value), en = new Date(form.end.value);
    if (en < s) return toast('The end time is before the start time.', 'error');
    const row = {
      title: form.title.value.trim(),
      starts_at: s.toISOString(),
      ends_at: en.toISOString(),
      location: form.location.value.trim() || null,
      notes: form.notes.value.trim() || null,
    };
    const { error } = ev
      ? await sb.from('events').update(row).eq('id', ev.id)
      : await sb.from('events').insert({ ...row, created_by: me() });
    if (error) return toast(errMsg(error), 'error');
    closeSheet();
    toast(ev ? 'Changes saved.' : 'Event created. Tap “Add to Google Calendar” to save it to yours.');
    view.past = false;
    view.root.querySelectorAll('.seg button').forEach((x, i) => { x.classList.toggle('on', i === 0); x.setAttribute('aria-selected', i === 0); });
    load();
  });
}
