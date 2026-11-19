export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

export const safeEqual = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
};

export async function sha256hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export function getCookie(request, name) {
  const m = (request.headers.get('cookie') || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : null;
}

/* Private link: the key from your link is checked against a hash stored in the database */
export async function privateKeyOk(env, key) {
  if (!key || key.length < 20) return false;
  const hash = await getMeta(env, 'app_key_hash');
  return !!hash && safeEqual(await sha256hex(key), hash);
}

export const londonDay = (d = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

export async function getMeta(env, k) {
  const row = await env.DB.prepare('SELECT v FROM meta WHERE k = ?1').bind(k).first();
  return row ? row.v : null;
}
export async function setMeta(env, k, v) {
  await env.DB.prepare('INSERT INTO meta (k, v) VALUES (?1, ?2) ON CONFLICT(k) DO UPDATE SET v = excluded.v').bind(k, v).run();
}
export async function delMeta(env, k) {
  await env.DB.prepare('DELETE FROM meta WHERE k = ?1').bind(k).run();
}

/* Google: returns a fresh access token, refreshing with the stored refresh token when needed */
export async function googleToken(env) {
  const cached = await getMeta(env, 'google_access');
  if (cached) {
    const c = JSON.parse(cached);
    if (c.exp > Date.now() + 60_000) return c.token;
  }
  const refresh = await getMeta(env, 'google_refresh');
  if (!refresh) throw new Error('google_not_connected');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refresh,
      grant_type: 'refresh_token',
    }),
  });
  const j = await r.json();
  if (!r.ok) {
    if (j.error === 'invalid_grant') {
      await delMeta(env, 'google_refresh');
      await delMeta(env, 'google_access');
    }
    throw new Error('google_refresh_failed');
  }
  await setMeta(env, 'google_access', JSON.stringify({ token: j.access_token, exp: Date.now() + j.expires_in * 1000 }));
  return j.access_token;
}

/* Cloudflare Access: verify the signed login token Cloudflare adds to every request */
let jwks = null;
const b64u = (s) =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));

async function accessKeys(team) {
  if (jwks && jwks.exp > Date.now()) return jwks.keys;
  const r = await fetch(`${team.replace(/\/$/, '')}/cdn-cgi/access/certs`);
  const j = await r.json();
  jwks = { keys: j.keys || [], exp: Date.now() + 3_600_000 };
  return jwks.keys;
}

export async function verifyAccess(token, env) {
  const [h, p, s] = token.split('.');
  if (!h || !p || !s) throw new Error('bad token');
  const dec = new TextDecoder();
  const header = JSON.parse(dec.decode(b64u(h)));
  const payload = JSON.parse(dec.decode(b64u(p)));
  const jwk = (await accessKeys(env.ACCESS_TEAM_DOMAIN)).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('unknown key');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64u(s), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw new Error('bad signature');
  if (!payload.exp || payload.exp * 1000 < Date.now()) throw new Error('expired');
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(env.ACCESS_AUD)) throw new Error('wrong audience');
  if (env.ALLOWED_EMAIL && String(payload.email || '').toLowerCase() !== env.ALLOWED_EMAIL.toLowerCase()) throw new Error('not allowed');
  return payload;
}
