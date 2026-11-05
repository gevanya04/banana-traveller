// POST /api/remove-member  { userId }  — admin only.
// Deletes the member's uploaded files, then their account (which removes
// their profile, memories, comments, reactions, pokes, messages and events).
import { requireAdmin, sbFetch, send, readBody } from './_supabase-admin.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  const adminId = await requireAdmin(req, res);
  if (!adminId) return;

  const userId = String(readBody(req).userId || '');
  if (!UUID.test(userId)) return send(res, 400, { error: 'Unknown member.' });
  if (userId === adminId) return send(res, 400, { error: "You can't remove yourself." });

  // 1. Remove their files from the private media bucket
  for (let round = 0; round < 20; round++) {
    const list = await sbFetch('/storage/v1/object/list/media', {
      method: 'POST',
      body: JSON.stringify({ prefix: `${userId}/`, limit: 1000, offset: 0 }),
    });
    const names = Array.isArray(list.body) ? list.body.filter((f) => f.id).map((f) => `${userId}/${f.name}`) : [];
    if (!names.length) break;
    await sbFetch('/storage/v1/object/media', { method: 'DELETE', body: JSON.stringify({ prefixes: names }) });
  }

  // 2. Delete the account
  const del = await sbFetch(`/auth/v1/admin/users/${userId}`, { method: 'DELETE' });
  if (!del.ok) {
    return send(res, del.status || 500, { error: del.body?.msg || del.body?.message || 'Could not remove member.' });
  }
  return send(res, 200, { ok: true });
}
