import { json } from '../../lib/util.js';

// Two-way sync. The app sends what changed since it last synced and gets back
// everything changed on the server since `since` (including edits from your other devices).
const COLLECTIONS = new Set(['tasks', 'notes', 'projects', 'habits', 'inbox', 'chats', 'assistants', 'journal', 'meta']);

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad json' }, 400);
  }
  const since = Number(body.since) || 0;
  const changes = Array.isArray(body.changes) ? body.changes : [];
  if (changes.length > 2000) return json({ error: 'too many changes' }, 413);

  const now = Date.now();
  const stmts = [];
  for (const c of changes) {
    if (!c || !COLLECTIONS.has(c.collection) || typeof c.id !== 'string' || !c.id || c.id.length > 200) continue;
    const del = c.data === null || c.data === undefined;
    const data = del ? null : JSON.stringify(c.data);
    if (data && data.length > 500_000) continue;
    stmts.push(
      env.DB.prepare(
        `INSERT INTO items (collection, id, data, updated_at, deleted) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(collection, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, deleted = excluded.deleted`
      ).bind(c.collection, c.id, data, now, del ? 1 : 0)
    );
  }
  for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));

  const { results } = since
    ? await env.DB.prepare('SELECT collection, id, data, deleted FROM items WHERE updated_at >= ?1').bind(since).all()
    : await env.DB.prepare('SELECT collection, id, data, deleted FROM items WHERE deleted = 0').all();

  return json({
    now,
    changes: results.map((r) => ({ collection: r.collection, id: r.id, data: r.deleted ? null : JSON.parse(r.data) })),
  });
}
