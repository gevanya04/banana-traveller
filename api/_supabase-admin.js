// Shared helpers for the admin-only Vercel functions.
// Files starting with "_" are not exposed as routes by Vercel.
// Needs two Vercel environment variables:
//   SUPABASE_URL               e.g. https://abcd1234.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY  the service_role / secret key (never put this in the front end)

const URL_ = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export function adminHeaders(extra = {}) {
  const h = { apikey: KEY, 'Content-Type': 'application/json', ...extra };
  // Legacy service_role keys are JWTs and also go in Authorization;
  // new sb_secret_ keys only go in the apikey header.
  if (KEY.startsWith('eyJ') && !h.Authorization) h.Authorization = `Bearer ${KEY}`;
  return h;
}

export async function sbFetch(path, options = {}) {
  const res = await fetch(`${URL_}${path}`, { ...options, headers: adminHeaders(options.headers) });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { ok: res.ok, status: res.status, body };
}

export function send(res, status, payload) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

// Confirms the caller is signed in AND has role = 'admin'. Returns their user id or null.
export async function requireAdmin(req, res) {
  if (!URL_ || !KEY) {
    send(res, 500, { error: 'Server is missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Add them in Vercel → Settings → Environment Variables, then redeploy.' });
    return null;
  }
  if (req.method !== 'POST') { send(res, 405, { error: 'Use POST.' }); return null; }

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) { send(res, 401, { error: 'Please sign in again.' }); return null; }

  const who = await sbFetch('/auth/v1/user', { headers: { Authorization: `Bearer ${token}` } });
  if (!who.ok || !who.body?.id) { send(res, 401, { error: 'Your session has expired. Please sign in again.' }); return null; }

  const prof = await sbFetch(`/rest/v1/profiles?id=eq.${encodeURIComponent(who.body.id)}&select=role`);
  if (!prof.ok || prof.body?.[0]?.role !== 'admin') { send(res, 403, { error: 'Only the admin can do this.' }); return null; }

  return who.body.id;
}

export function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch { return {}; }
}
