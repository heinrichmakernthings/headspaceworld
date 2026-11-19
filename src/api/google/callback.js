import { setMeta, delMeta } from '../../../lib/util.js';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const back = (q) => Response.redirect(`${url.origin}/?google=${q}#connections`, 302);
  const cookie = request.headers.get('cookie') || '';
  const saved = (cookie.match(/(?:^|;\s*)hs_gstate=([^;]+)/) || [])[1];
  if (url.searchParams.get('error')) return back('cancelled');
  if (!saved || saved !== url.searchParams.get('state')) return back('state');

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: url.searchParams.get('code') || '',
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${url.origin}/api/google/callback`,
      grant_type: 'authorization_code',
    }),
  });
  const j = await r.json();
  if (!r.ok || !j.refresh_token) return back('failed');

  let email = '';
  try {
    email = JSON.parse(atob(j.id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).email || '';
  } catch {}
  await setMeta(env, 'google_refresh', j.refresh_token);
  await setMeta(env, 'google_access', JSON.stringify({ token: j.access_token, exp: Date.now() + j.expires_in * 1000 }));
  if (email) await setMeta(env, 'google_email', email);
  else await delMeta(env, 'google_email');
  return back('connected');
}
