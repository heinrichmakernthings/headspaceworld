import { json, getMeta, londonDay } from '../../../lib/util.js';

const SUM = { step_count: 'steps', active_energy: 'energy', walking_running_distance: 'distance', apple_exercise_time: 'exercise', mindful_minutes: 'mindful', sleep_analysis: 'sleep' };
const AVG = { resting_heart_rate: 'restingHr', heart_rate_variability: 'hrv', weight_body_mass: 'weight' };

export async function onRequestGet({ request, env }) {
  const days = Math.max(1, Math.min(31, Number(new URL(request.url).searchParams.get('days')) || 7));
  const todayKey = londonDay();
  const keys = [];
  for (let i = days - 1; i >= 0; i--) keys.push(londonDay(new Date(Date.now() - i * 864e5)));
  const from = keys[0];

  const [{ results: rows }, { results: wk }, last] = await Promise.all([
    env.DB.prepare('SELECT day, metric, SUM(qty) AS s, AVG(qty) AS a FROM health_points WHERE day >= ?1 GROUP BY day, metric').bind(from).all(),
    env.DB.prepare('SELECT day, name, minutes, energy FROM workouts WHERE day >= ?1 ORDER BY start').bind(from).all(),
    getMeta(env, 'health_last'),
  ]);

  const map = Object.fromEntries(keys.map((k) => [k, { date: k, workouts: [] }]));
  for (const r of rows) {
    const d = map[r.day];
    if (!d) continue;
    if (SUM[r.metric]) d[SUM[r.metric]] = Math.round(r.s * 100) / 100;
    if (AVG[r.metric]) d[AVG[r.metric]] = Math.round(r.a * 10) / 10;
  }
  for (const w of wk) map[w.day]?.workouts.push({ name: w.name, minutes: w.minutes, energy: w.energy });

  return json({ today: todayKey, last, days: keys.map((k) => map[k]) });
}
