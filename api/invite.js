// POST /api/invite  { email }  — admin only. Emails the friend a link to join.
import { requireAdmin, sbFetch, send, readBody } from './_supabase-admin.js';

export default async function handler(req, res) {
  const adminId = await requireAdmin(req, res);
  if (!adminId) return;

  const email = String(readBody(req).email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return send(res, 400, { error: 'That email address doesn’t look right.' });

  // Send people back to this same site after they click the invite
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const redirectTo = process.env.SITE_URL || `${proto}://${host}/`;

  const r = await sbFetch(`/auth/v1/invite?redirect_to=${encodeURIComponent(redirectTo)}`, {
    method: 'POST',
    body: JSON.stringify({ email }),
  });

  if (!r.ok) {
    const msg = r.body?.msg || r.body?.message || r.body?.error_description || r.body?.error || 'Invite failed.';
    if (/already been registered|already registered|exists/i.test(msg)) {
      return send(res, 409, { error: `${email} already has an account.` });
    }
    return send(res, r.status || 500, { error: msg });
  }
  return send(res, 200, { ok: true });
}
