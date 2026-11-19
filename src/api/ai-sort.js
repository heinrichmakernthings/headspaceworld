import { json } from '../../lib/util.js';

// Suggests where each brain-dump item should go: task (with project and due date), note, idea or drop.
const KINDS = ['task', 'note', 'idea', 'drop'];

function parse(text) {
  try { return JSON.parse(text); } catch {}
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return {};
}

export async function onRequestPost({ request, env }) {
  let b;
  try { b = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
  const items = (Array.isArray(b.items) ? b.items : []).slice(0, 40).map((i) => ({ id: String(i.id), text: String(i.text || '').slice(0, 600) }));
  const projects = (Array.isArray(b.projects) ? b.projects : []).slice(0, 30).map(String);
  if (!items.length) return json({ suggestions: [] });
  const provider = b.provider === 'chatgpt' ? 'chatgpt' : 'claude';
  const prompt = `Today is ${b.today} (${b.weekday || ''}). Sam has brain-dumped these thoughts. Sort each one.
For each item choose "kind":
• "task": something to do
• "note": information worth keeping for reference
• "idea": a possibility for later, not an action now
• "drop": not worth keeping (duplicate, noise)
For tasks: pick the best "project" from this list, or "Personal" if none fit: ${JSON.stringify(projects)}. Write a short, clear "title" starting with a verb. Add "due" as YYYY-MM-DD only if the text implies a date (e.g. "Friday", "tomorrow", "next week"), otherwise "".
For notes and ideas: "title" is a short heading.
Reply ONLY with JSON: {"suggestions":[{"id":"...","kind":"...","project":"...","title":"...","due":""}]}

Items:
${JSON.stringify(items)}`;

  let out = {};
  try {
    if (env.AI_MOCK === '1') {
      out = { suggestions: items.map((i, n) => ({ id: i.id, kind: n % 3 === 2 ? 'idea' : 'task', project: projects.find((p) => i.text.toLowerCase().includes(p.toLowerCase())) || 'Personal', title: i.text.slice(0, 60), due: '' })) };
    } else if (provider === 'claude') {
      if (!env.ANTHROPIC_API_KEY) return json({ error: 'no_ai' }, 409);
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: env.ANTHROPIC_MODEL || 'claude-sonnet-5-5', max_tokens: 3000, messages: [{ role: 'user', content: prompt }] }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error?.message || 'Claude error');
      out = parse((j.content || []).map((c) => c.text || '').join(''));
    } else {
      if (!env.OPENAI_API_KEY) return json({ error: 'no_ai' }, 409);
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: env.OPENAI_MODEL || 'chat-latest', messages: [{ role: 'user', content: prompt }], response_format: { type: 'json_object' } }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error?.message || 'ChatGPT error');
      out = parse(j.choices?.[0]?.message?.content);
    }
  } catch (e) {
    return json({ error: e.message }, 502);
  }
  const ids = new Set(items.map((i) => i.id));
  const suggestions = (Array.isArray(out.suggestions) ? out.suggestions : [])
    .filter((s) => s && ids.has(String(s.id)) && KINDS.includes(s.kind))
    .map((s) => ({
      id: String(s.id),
      kind: s.kind,
      project: projects.includes(s.project) ? s.project : 'Personal',
      title: String(s.title || '').slice(0, 200),
      due: /^\d{4}-\d{2}-\d{2}$/.test(s.due || '') ? s.due : '',
    }));
  return json({ suggestions });
}
