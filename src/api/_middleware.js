import { json, verifyAccess } from '../../lib/util.js';

// Every /api route needs a valid Cloudflare Access login, except the Apple Health webhook,
// which your iPhone calls with its own secret token instead.
const OPEN = new Set(['/api/health/ingest']);

export async function onRequest({ request, env, next, data }) {
  const path = new URL(request.url).pathname;
  if (OPEN.has(path)) return next();

  if (env.DEV_NO_AUTH === '1') {
    data.email = env.ALLOWED_EMAIL || 'dev@localhost';
    return next();
  }
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return json({ error: 'auth' }, 401);
  try {
    const payload = await verifyAccess(token, env);
    data.email = payload.email;
    return next();
  } catch {
    return json({ error: 'auth' }, 401);
  }
}
