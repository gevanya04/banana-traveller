import { sb, state, me, authLink, configured, loadProfiles, toast, person, emit, setBadge, errMsg } from './core.js';
import { renderLogin, renderNotConfigured, renderSetPassword, renderPending } from './auth.js';
import * as feed from './feed.js';
import * as events from './events.js';
import * as chat from './chat.js';
import * as friends from './friends.js';
import * as meView from './me.js';
import './pwa.js';

const VIEWS = { feed, events, chat, friends, me: meView };
const app = document.getElementById('app');
const tabbar = document.getElementById('tabbar');

let cleanup = null;
let channel = null;
let started = false;
let pendingPasswordSetup = authLink.type === 'invite' || authLink.type === 'recovery';

/* ---------- routing ---------- */
async function route() {
  if (!state.user || !state.profile) return;
  const [name, param] = (location.hash.replace(/^#\/?/, '') || 'feed').split('/');
  const view = VIEWS[name] ? name : 'feed';

  try { cleanup?.(); } catch { /* ignore */ }
  cleanup = null;

  tabbar.querySelectorAll('a').forEach((a) => {
    const on = a.dataset.tab === view;
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  document.body.dataset.view = view + (param ? '-thread' : '');

  const container = document.createElement('main');
  container.className = 'view';
  app.replaceChildren(container);
  window.scrollTo(0, 0);
  try {
    cleanup = await VIEWS[view].render(container, param) || null;
  } catch (err) {
    console.error(err);
    container.innerHTML = `<div class="empty"><p class="empty-title">Couldn't load this page</p><p class="muted">${errMsg(err)}</p></div>`;
  }
}

/* ---------- realtime: chat, pokes, new memories ---------- */
function subscribe() {
  channel?.unsubscribe();
  channel = sb.channel('banana-live')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, ({ new: m }) => {
      emit('message:new', m);
      if (m.sender_id === me()) return;
      const viewing = location.hash === `#chat/${chat.convOf(m)}`;
      if (!viewing) {
        setBadge('chat', true);
        if (m.recipient_id) toast(`💬 ${person(m.sender_id).display_name}: ${m.body.slice(0, 60)}`);
      }
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, ({ old }) => emit('message:deleted', old))
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pokes', filter: `to_id=eq.${me()}` }, ({ new: p }) => {
      emit('poke:new', p);
      if (!location.hash.startsWith('#friends')) setBadge('friends', true);
      toast(`👉 ${person(p.from_id).display_name} poked you!`);
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'memories' }, ({ new: m }) => emit('memory:new', m))
    .subscribe();
}

/* ---------- start the signed-in app ---------- */
async function startApp() {
  if (started) return;
  started = true;
  try {
    await loadProfiles();
  } catch (err) {
    started = false;
    toast(errMsg(err), 'error');
    return;
  }
  if (!state.profile) {
    started = false;
    await sb.auth.signOut();
    renderLogin(app, "Your account isn't set up in Banana Traveller. Try creating it again.");
    return;
  }
  if (state.profile.status === 'pending') {
    started = false;
    tabbar.hidden = true;
    document.body.dataset.view = 'auth';
    renderPending(app, {
      name: state.profile.display_name,
      onCheck: async () => {
        await loadProfiles();
        if (state.profile?.status === 'approved') { toast('You’re approved. Welcome!'); startApp(); }
        else toast('Still waiting for the admin.');
      },
    });
    return;
  }
  tabbar.hidden = false;
  subscribe();
  if (!location.hash || location.hash.includes('access_token')) history.replaceState(null, '', '#feed');
  await route();
  chat.hasUnread().then((u) => setBadge('chat', u));
  setBadge('me', state.pending.length > 0);
  friends.unseenPokes().then((n) => setBadge('friends', n > 0 && !location.hash.startsWith('#friends')));
}

function stopApp(notice = '') {
  started = false;
  try { cleanup?.(); } catch { /* ignore */ }
  cleanup = null;
  channel?.unsubscribe();
  channel = null;
  state.user = null; state.profile = null; state.profiles = new Map();
  tabbar.hidden = true;
  document.body.dataset.view = 'auth';
  renderLogin(app, notice);
}

async function handleSession(session) {
  state.user = session?.user || null;
  if (!state.user) return stopApp();
  if (pendingPasswordSetup) {
    document.body.dataset.view = 'auth';
    tabbar.hidden = true;
    const { data } = await sb.from('profiles').select('display_name').eq('id', state.user.id).maybeSingle();
    renderSetPassword(app, {
      isInvite: authLink.type === 'invite',
      currentName: data?.display_name,
      onDone: () => { pendingPasswordSetup = false; history.replaceState(null, '', '#feed'); startApp(); },
    });
    return;
  }
  startApp();
}

async function boot() {
  document.body.dataset.view = 'auth';
  if (!configured) return renderNotConfigured(app);

  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    pendingPasswordSetup = false;
    return stopApp(authLink.error ? `That link didn't work: ${authLink.error}. Ask for a new one.` : '');
  }
  await handleSession(session);

  sb.auth.onAuthStateChange((event, s) => {
    if (event === 'PASSWORD_RECOVERY') { pendingPasswordSetup = true; handleSession(s); return; }
    if (event === 'SIGNED_OUT') return stopApp();
    if (event === 'SIGNED_IN' && !started && !pendingPasswordSetup) {
      // defer: Supabase recommends not awaiting other calls inside this callback
      setTimeout(() => handleSession(s), 0);
    }
  });
}

window.addEventListener('hashchange', () => { if (started) route(); });

// Before sign-in, onAuthStateChange must be listening too
sb.auth.onAuthStateChange((event, s) => {
  if (!started && event === 'SIGNED_IN' && !pendingPasswordSetup && document.querySelector('.auth form')) {
    setTimeout(() => handleSession(s), 0);
  }
});

boot();
