import { json, getMeta } from '../../lib/util.js';

export async function onRequestGet({ env, data }) {
  const [gEmail, gRefresh, healthLast] = await Promise.all([
    getMeta(env, 'google_email'),
    getMeta(env, 'google_refresh'),
    getMeta(env, 'health_last'),
  ]);
  return json({
    app: 'headspace',
    email: data.email || null,
    google: {
      configured: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
      connected: !!gRefresh,
      email: gEmail,
      picker: !!(env.GOOGLE_API_KEY && env.GOOGLE_APP_ID),
    },
    health: { configured: !!env.HEALTH_TOKEN, last: healthLast },
  });
}
