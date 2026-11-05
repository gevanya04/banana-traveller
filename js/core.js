import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';

// Read invite / reset-password info from the link BEFORE Supabase clears it
const linkParams = new URLSearchParams(location.hash.slice(1) || location.search.slice(1));
export const authLink = {
  type: linkParams.get('type'),                       // 'invite' | 'recovery' | 'signup' | null
  error: linkParams.get('error_description'),
};

export const configured =
  !SUPABASE_URL.includes('YOUR-') && !SUPABASE_ANON_KEY.includes('YOUR-');

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // Supabase free plan per-file limit
export const BUCKET = 'media';

export const state = {
  user: null,
  profile: null,
  profiles: new Map(),   // approved members
  pending: [],           // sign-ups waiting for approval (admin only)
};

export const isAdmin = () => state.profile?.role === 'admin';
export const me = () => state.user?.id;

/* ---------- small DOM helpers ---------- */
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function toast(message, kind = 'info') {
  const box = document.getElementById('toasts');
  const node = h(`<div class="toast toast-${kind}" role="status">${esc(message)}</div>`);
  box.append(node);
  setTimeout(() => node.classList.add('out'), 3200);
  setTimeout(() => node.remove(), 3600);
}

export function errMsg(error) {
  return error?.message || String(error || 'Something went wrong');
}

export function timeAgo(iso) {
  const s = Math.round((Date.now() - new Date(iso)) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const hr = Math.round(m / 60);
  if (hr < 24) return `${hr}h`;
  const d = Math.round(hr / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d > 300 ? 'numeric' : undefined });
}

/* ---------- signed URLs for the private media bucket ---------- */
const urlCache = new Map(); // path -> { url, exp }

export async function signedUrls(paths) {
  const now = Date.now();
  const need = [...new Set(paths.filter(Boolean))].filter((p) => !(urlCache.get(p)?.exp > now));
  if (need.length) {
    for (let i = 0; i < need.length; i += 100) {
      const chunk = need.slice(i, i + 100);
      const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(chunk, 3600);
      if (error) { console.error(error); continue; }
      data.forEach((d) => d.signedUrl && urlCache.set(d.path, { url: d.signedUrl, exp: now + 55 * 60 * 1000 }));
    }
  }
  return (p) => urlCache.get(p)?.url || '';
}

export const cachedUrl = (p) => urlCache.get(p)?.url || '';

/* ---------- people ---------- */
export async function loadProfiles() {
  const { data, error } = await sb.from('profiles').select('*').order('display_name');
  if (error) throw error;
  state.profile = data.find((p) => p.id === me()) || null;
  state.profiles = new Map(data.filter((p) => p.status !== 'pending').map((p) => [p.id, p]));
  state.pending = data.filter((p) => p.status === 'pending' && p.id !== me());
  await signedUrls(data.map((p) => p.avatar_path));
  return data;
}

export const person = (id) =>
  state.profiles.get(id) || state.pending.find((p) => p.id === id)
  || { id, display_name: 'Former member', avatar_path: null };

const HUES = [48, 172, 8, 205, 280, 130, 330, 25];
export function avatar(id, size = 40) {
  const p = person(id);
  const url = cachedUrl(p.avatar_path);
  const style = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px`;
  if (url) return `<img class="avatar" style="${style}" src="${esc(url)}" alt="">`;
  const hue = HUES[[...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];
  const initial = esc((p.display_name || '?').trim().charAt(0).toUpperCase());
  return `<span class="avatar avatar-initial" style="${style};--hue:${hue}" aria-hidden="true">${initial}</span>`;
}

/* ---------- bottom sheet ---------- */
export function openSheet(innerHTML) {
  closeSheet();
  const wrap = h(`
    <div class="sheet-wrap" id="sheet">
      <div class="sheet-backdrop" data-close></div>
      <div class="sheet" role="dialog" aria-modal="true">${innerHTML}</div>
    </div>`);
  wrap.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeSheet(); });
  document.body.append(wrap);
  requestAnimationFrame(() => wrap.classList.add('open'));
  wrap.querySelector('input, textarea, select')?.focus({ preventScroll: true });
  return wrap.querySelector('.sheet');
}

export function closeSheet() {
  document.getElementById('sheet')?.remove();
}

export function setBadge(name, on) {
  const b = document.querySelector(`[data-badge="${name}"]`);
  if (b) b.hidden = !on;
}

/* simple event bus for realtime updates */
export const bus = new EventTarget();
export const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));
