// Single-file build for pasting into the Cloudflare dashboard (no assets folder needed)
import worker from './worker.js';
import html from '../public/index.html';
import manifest from '../public/manifest.webmanifest';
import i180 from '../public/icon-180.png';
import i192 from '../public/icon-192.png';
import i512 from '../public/icon-512.png';

const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const files = {
  '/': [html, 'text/html; charset=utf-8'],
  '/index.html': [html, 'text/html; charset=utf-8'],
  '/manifest.webmanifest': [manifest, 'application/manifest+json'],
  '/icon-180.png': [b64(i180), 'image/png'],
  '/icon-192.png': [b64(i192), 'image/png'],
  '/icon-512.png': [b64(i512), 'image/png'],
};
const ASSETS = {
  fetch(request) {
    const f = files[new URL(request.url).pathname];
    if (!f) return new Response('Not found', { status: 404 });
    return new Response(f[0], { headers: { 'content-type': f[1], 'cache-control': 'no-cache' } });
  },
};
export default {
  fetch(request, env, ctx) {
    return worker.fetch(request, { ...env, ASSETS }, ctx);
  },
};
