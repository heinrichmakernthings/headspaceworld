import { json } from '../../lib/util.js';
import { ensureBackupTable, makeBackup } from '../../lib/backup.js';

// GET  /api/backups          -> list of snapshots
// GET  /api/backups?id=12    -> one snapshot's data (to restore)
// POST /api/backups          -> make a snapshot now
export async function onRequestGet({ request, env }) {
  await ensureBackupTable(env);
  const id = Number(new URL(request.url).searchParams.get('id'));
  if (id) {
    const row = await env.DB.prepare('SELECT data FROM backups WHERE id = ?1').bind(id).first();
    if (!row) return json({ error: 'not found' }, 404);
    return new Response(row.data, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  }
  const { results } = await env.DB.prepare('SELECT id, created_at, kind, items, bytes FROM backups ORDER BY created_at DESC').all();
  return json({ backups: results });
}

export async function onRequestPost({ env }) {
  return json(await makeBackup(env, 'manual'));
}
