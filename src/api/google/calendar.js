import { json, googleToken } from '../../../lib/util.js';

const TZ = 'Europe/London';
const pad = (n) => String(n).padStart(2, '0');

// GET  /api/google/calendar?days=14   -> your upcoming events (primary calendar)
export async function onRequestGet({ request, env }) {
  let token;
  try {
    token = await googleToken(env);
  } catch (e) {
    return json({ error: e.message }, 409);
  }
  const days = Math.max(1, Math.min(60, Number(new URL(request.url).searchParams.get('days')) || 14));
  const start = new Date(Date.now() - 864e5);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(Date.now() + days * 864e5);
  const q = new URLSearchParams({ singleEvents: 'true', orderBy: 'startTime', maxResults: '250', timeMin: start.toISOString(), timeMax: end.toISOString(), timeZone: TZ });
  const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${q}`, { headers: { authorization: `Bearer ${token}` } });
  const j = await r.json();
  if (!r.ok) return json({ error: j.error?.message || 'calendar error' }, 502);
  return json({
    events: (j.items || [])
      .filter((e) => e.status !== 'cancelled')
      .map((e) => ({
        id: e.id,
        title: e.summary || '(No title)',
        start: e.start?.dateTime || e.start?.date,
        end: e.end?.dateTime || e.end?.date,
        allDay: !!e.start?.date,
        location: e.location || '',
        link: e.htmlLink,
      })),
  });
}

// POST /api/google/calendar  {title, date, time?, minutes?, detail?}  -> creates an event
export async function onRequestPost({ request, env }) {
  let token;
  try {
    token = await googleToken(env);
  } catch (e) {
    return json({ error: e.message }, 409);
  }
  const b = await request.json().catch(() => ({}));
  if (!b.title || !/^\d{4}-\d{2}-\d{2}$/.test(b.date || '')) return json({ error: 'title and date needed' }, 400);
  const event = { summary: String(b.title).slice(0, 250), description: b.detail ? String(b.detail).slice(0, 4000) : 'Added from Headspace' };
  if (b.time && /^\d{2}:\d{2}$/.test(b.time)) {
    const s = new Date(`${b.date}T${b.time}:00Z`);
    const e = new Date(s.getTime() + (Number(b.minutes) || 30) * 60000);
    const fmt = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00`;
    event.start = { dateTime: fmt(s), timeZone: TZ };
    event.end = { dateTime: fmt(e), timeZone: TZ };
  } else {
    const n = new Date(`${b.date}T12:00:00Z`);
    n.setUTCDate(n.getUTCDate() + 1);
    event.start = { date: b.date };
    event.end = { date: n.toISOString().slice(0, 10) };
  }
  const r = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(event),
  });
  const j = await r.json();
  if (!r.ok) return json({ error: j.error?.message || 'calendar error' }, 502);
  return json({ id: j.id, link: j.htmlLink });
}
