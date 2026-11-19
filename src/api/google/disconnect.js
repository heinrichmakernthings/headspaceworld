import { json, getMeta, delMeta } from '../../../lib/util.js';

export async function onRequestPost({ env }) {
  const refresh = await getMeta(env, 'google_refresh');
  if (refresh) {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refresh)}`, { method: 'POST' }).catch(() => {});
  }
  await Promise.all(['google_refresh', 'google_access', 'google_email'].map((k) => delMeta(env, k)));
  return json({ ok: true });
}
