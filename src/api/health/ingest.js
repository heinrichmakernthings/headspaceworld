import { json, setMeta } from '../../../lib/util.js';

// Receives Apple Health data from the Health Auto Export iPhone app (REST API automation).
// Protected by its own secret: header  Authorization: Bearer <HEALTH_TOKEN>
const KEEP = new Set([
  'step_count',
  'active_energy',
  'walking_running_distance',
  'apple_exercise_time',
  'resting_heart_rate',
  'heart_rate_variability',
  'sleep_analysis',
  'mindful_minutes',
  'weight_body_mass',
]);

const safeEqual = (a, b) => {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
};

export async function onRequestPost({ request, env }) {
  const auth = request.headers.get('authorization') || '';
  if (!env.HEALTH_TOKEN || !safeEqual(auth, `Bearer ${env.HEALTH_TOKEN}`)) return json({ error: 'unauthorised' }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'expected JSON (set Export Format to JSON in Health Auto Export)' }, 400);
  }
  const d = body.data || body;
  const metrics = Array.isArray(d.metrics) ? d.metrics : [];
  const workouts = Array.isArray(d.workouts) ? d.workouts : [];
  const stmts = [];

  for (const m of metrics) {
    if (!KEEP.has(m.name)) continue;
    for (const p of m.data || []) {
      if (!p || !p.date) continue;
      let q = p.qty ?? p.totalSleep ?? p.asleep ?? p.Avg ?? null;
      if (typeof q !== 'number' || !isFinite(q)) continue;
      if (m.name === 'active_energy' && /kj/i.test(m.units || '')) q = q / 4.184;
      stmts.push(
        env.DB.prepare(
          'INSERT INTO health_points (metric, ts, day, qty, unit) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(metric, ts) DO UPDATE SET qty = excluded.qty, unit = excluded.unit'
        ).bind(m.name, String(p.date), String(p.date).slice(0, 10), q, m.units || '')
      );
    }
  }

  for (const w of workouts) {
    const start = w.start || w.startDate;
    if (!start) continue;
    const secs = typeof w.duration === 'number' ? w.duration : 0;
    const energy = w.activeEnergyBurned?.qty ?? w.activeEnergy?.qty ?? null;
    const id = String(w.id || `${start}-${w.name || 'workout'}`);
    stmts.push(
      env.DB.prepare(
        'INSERT INTO workouts (id, name, start, day, minutes, energy) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT(id) DO UPDATE SET name = excluded.name, minutes = excluded.minutes, energy = excluded.energy'
      ).bind(id, w.name || 'Workout', String(start), String(start).slice(0, 10), Math.round(secs / 60), energy)
    );
  }

  for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
  await setMeta(env, 'health_last', new Date().toISOString());
  return json({ ok: true, saved: stmts.length });
}
