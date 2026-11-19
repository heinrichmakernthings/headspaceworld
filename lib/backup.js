// Snapshots of all your Headspace data, stored in your own D1 database.
const KEEP = 12;

export async function ensureBackupTable(env) {
  await env.DB.prepare(
    'CREATE TABLE IF NOT EXISTS backups (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL, kind TEXT, items INTEGER, bytes INTEGER, data TEXT NOT NULL)'
  ).run();
}

export async function makeBackup(env, kind = 'weekly') {
  await ensureBackupTable(env);
  const { results } = await env.DB.prepare('SELECT collection, id, data FROM items WHERE deleted = 0').all();
  const data = JSON.stringify({ version: 1, created: new Date().toISOString(), items: results.map((r) => ({ collection: r.collection, id: r.id, data: JSON.parse(r.data) })) });
  const now = Date.now();
  const res = await env.DB.prepare('INSERT INTO backups (created_at, kind, items, bytes, data) VALUES (?1, ?2, ?3, ?4, ?5)')
    .bind(now, kind, results.length, data.length, data)
    .run();
  await env.DB.prepare('DELETE FROM backups WHERE id NOT IN (SELECT id FROM backups ORDER BY created_at DESC LIMIT ?1)').bind(KEEP).run();
  return { id: res.meta?.last_row_id, created_at: now, kind, items: results.length, bytes: data.length };
}
