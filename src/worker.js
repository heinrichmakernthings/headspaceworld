// Headspace Worker: serves the app from /public and the API from /api/*
import { json } from '../lib/util.js';
import { onRequest as guard } from './api/_middleware.js';
import * as me from './api/me.js';
import * as sync from './api/sync.js';
import * as healthIngest from './api/health/ingest.js';
import * as healthSummary from './api/health/summary.js';
import * as gAuth from './api/google/auth.js';
import * as gCallback from './api/google/callback.js';
import * as gToken from './api/google/token.js';
import * as gCalendar from './api/google/calendar.js';
import * as gDisconnect from './api/google/disconnect.js';

const routes = {
  '/api/me': me,
  '/api/sync': sync,
  '/api/health/ingest': healthIngest,
  '/api/health/summary': healthSummary,
  '/api/google/auth': gAuth,
  '/api/google/callback': gCallback,
  '/api/google/token': gToken,
  '/api/google/calendar': gCalendar,
  '/api/google/disconnect': gDisconnect,
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    const mod = routes[url.pathname.replace(/\/$/, '')];
    if (!mod) return json({ error: 'not found' }, 404);
    const m = request.method.toUpperCase();
    const handler = mod[`onRequest${m[0]}${m.slice(1).toLowerCase()}`] || mod.onRequest;
    if (!handler) return json({ error: 'method not allowed' }, 405);

    const data = {};
    const context = { request, env, data, waitUntil: (p) => ctx.waitUntil(p) };
    try {
      return await guard({ ...context, next: () => handler(context) });
    } catch (e) {
      console.error(e);
      return json({ error: 'server error' }, 500);
    }
  },
};
