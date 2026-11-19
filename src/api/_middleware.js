import { json, verifyAccess, privateKeyOk, getCookie } from '../../lib/util.js';

// Every /api route needs either your private link key (saved on each device when you open the link)
// or a Cloudflare Access login. The Apple Health webhook checks its own token instead.
const OPEN = new Set(['/api/health/ingest']);

export async function onRequest({ request, env, next, data }) {
  const path = new URL(request.url).pathname;
  if (OPEN.has(path)) return next();

  if (env.DEV_NO_AUTH === '1') {
    data.email = env.ALLOWED_EMAIL || 'dev@localhost';
    return next();
  }

  const key = request.headers.get('x-headspace-key') || getCookie(request, 'hs_key');
  if (key && (await privateKeyOk(env, key))) {
    data.email = env.ALLOWED_EMAIL || null;
    data.via = 'link';
    return next();
  }

  const token = request.headers.get('cf-access-jwt-assertion');
  if (token && env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD) {
    try {
      const payload = await verifyAccess(token, env);
      data.email = payload.email;
      data.via = 'access';
      return next();
    } catch {}
  }
  return json({ error: 'auth' }, 401);
}
