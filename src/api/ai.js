import { json } from '../../lib/util.js';

// Headspace's built-in assistant. Uses Claude (ANTHROPIC_API_KEY) or ChatGPT (OPENAI_API_KEY).
// Always answers with { reply, actions[], chips[] } so the app can show tappable buttons.

const VIEWS = ['today', 'tasks', 'projects', 'notes', 'journal', 'later', 'calendar', 'connections'];
const TYPES = ['add_task', 'complete_task', 'focus_tasks', 'add_note', 'add_idea', 'add_project', 'inbox_to_task', 'clear_inbox_item', 'open'];

const SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string', description: 'Your message to Sam. Plain text, short, warm, practical. Use line breaks for lists.' },
    actions: {
      type: 'array',
      description: 'Up to 5 buttons Sam can tap. Nothing happens until he taps one.',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string', description: 'Button text, max 40 characters, starts with a verb' },
          type: { type: 'string', enum: TYPES },
          title: { type: 'string' },
          project: { type: 'string', description: 'Exact project name from context' },
          due: { type: 'string', description: 'YYYY-MM-DD' },
          priority: { type: 'integer', enum: [1, 2, 3] },
          minutes: { type: 'integer' },
          focus: { type: 'boolean', description: "Put in today's focus" },
          repeat: { type: 'string', enum: ['', 'daily', 'weekdays', 'weekly', 'monthly'] },
          id: { type: 'string', description: 'Task id from context (complete_task)' },
          ids: { type: 'array', items: { type: 'string' }, description: 'Up to 3 task ids from context (focus_tasks)' },
          body: { type: 'string' },
          name: { type: 'string' },
          emoji: { type: 'string' },
          blurb: { type: 'string' },
          inbox_id: { type: 'string' },
          view: { type: 'string', enum: VIEWS },
        },
        required: ['label', 'type'],
      },
    },
    chips: { type: 'array', items: { type: 'string' }, description: 'Up to 4 short follow-up messages Sam might want to send next (max 40 characters each)' },
  },
  required: ['reply', 'actions', 'chips'],
};

function systemPrompt(context) {
  return `You are the assistant inside Headspace, Sam's calm personal planner app. Sam is busy and wants less on his plate, not more.
Today is ${context?.today || 'unknown'} (Europe/London). Write in British English. Be brief (under 120 words), warm and practical. No markdown symbols like ** or #; use plain line breaks and "•" for lists.

You can't change anything yourself. Instead, offer buttons ("actions") that Sam can tap, and Headspace carries them out:
• add_task: title (+ optional project, due YYYY-MM-DD, priority 1 low / 2 normal / 3 high, minutes, focus, repeat)
• complete_task: id
• focus_tasks: ids (max 3), sets today's focus
• add_note: title, body (goes on his Notebook board)
• add_idea: title, body (goes to Ideas for later)
• add_project: name, emoji, blurb
• inbox_to_task: inbox_id, title (+ optional project, due)
• clear_inbox_item: inbox_id
• open: view (${VIEWS.join(', ')})
Only use ids and project names that appear in the context. Never say something is done; say what tapping will do. Offer 1 to 5 genuinely useful actions (none if it's just chat), and up to 4 short follow-up chips.

Sam's Headspace right now (JSON):
${JSON.stringify(context || {}).slice(0, 12000)}`;
}

function cleanMessages(messages) {
  const out = [];
  for (const m of (Array.isArray(messages) ? messages : []).slice(-16)) {
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    const content = String(m.content || '').slice(0, 4000);
    if (!content) continue;
    if (out.length && out[out.length - 1].role === role) out[out.length - 1].content += '\n\n' + content;
    else out.push({ role, content });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

function sanitise(r) {
  const s = (v, n) => (typeof v === 'string' ? v.slice(0, n) : undefined);
  const actions = (Array.isArray(r?.actions) ? r.actions : [])
    .filter((a) => a && TYPES.includes(a.type) && a.label)
    .slice(0, 6)
    .map((a) => ({
      ...a,
      label: s(a.label, 60),
      title: s(a.title, 250),
      body: s(a.body, 4000),
      ids: Array.isArray(a.ids) ? a.ids.slice(0, 3).map(String) : undefined,
      view: VIEWS.includes(a.view) ? a.view : undefined,
    }));
  const chips = (Array.isArray(r?.chips) ? r.chips : []).filter((c) => typeof c === 'string' && c.trim()).slice(0, 4).map((c) => c.slice(0, 60));
  return { reply: s(r?.reply, 4000) || '…', actions, chips };
}

function parseJSON(text) {
  try { return JSON.parse(text); } catch {}
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return { reply: String(text || '').slice(0, 2000), actions: [], chips: [] };
}

async function askClaude(env, system, messages) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
      max_tokens: 1500,
      system,
      messages,
      tools: [{ name: 'respond', description: 'Reply to Sam with a message, tappable actions and follow-up chips.', input_schema: SCHEMA }],
      tool_choice: { type: 'tool', name: 'respond' },
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || `Claude error ${r.status}`);
  const tool = (j.content || []).find((c) => c.type === 'tool_use');
  if (tool) return tool.input;
  return parseJSON((j.content || []).map((c) => c.text || '').join(''));
}

async function askChatGPT(env, system, messages) {
  const body = {
    model: env.OPENAI_MODEL || 'chat-latest',
    messages: [{ role: 'system', content: `${system}\n\nRespond ONLY with a JSON object of this shape: ${JSON.stringify(SCHEMA)}` }, ...messages],
    response_format: { type: 'json_object' },
  };
  let r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  let j = await r.json();
  if (!r.ok && /response_format/i.test(j.error?.message || '')) {
    delete body.response_format;
    r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    j = await r.json();
  }
  if (!r.ok) throw new Error(j.error?.message || `ChatGPT error ${r.status}`);
  return parseJSON(j.choices?.[0]?.message?.content);
}

function mock(context, messages) {
  const t = (context?.open_tasks || [])[0];
  const last = messages[messages.length - 1]?.content || '';
  return {
    reply: `Test mode. You said: "${last.slice(0, 80)}". Here are some things I could do.`,
    actions: [
      { label: 'Add “Book stage crew” for Friday', type: 'add_task', title: 'Book stage crew', project: 'Madruga', due: context?.today, priority: 3 },
      ...(t ? [{ label: `Focus on “${t.title}”`, type: 'focus_tasks', ids: [t.id] }] : []),
      { label: 'Save a note about this', type: 'add_note', title: 'From Ask', body: last },
      { label: 'Open Projects', type: 'open', view: 'projects' },
    ],
    chips: ['Plan my day', 'What’s overdue?'],
  };
}

export async function onRequestPost({ request, env }) {
  let b;
  try { b = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
  const provider = b.provider === 'chatgpt' ? 'chatgpt' : 'claude';
  const messages = cleanMessages(b.messages);
  if (!messages.length) return json({ error: 'say something first' }, 400);
  const system = systemPrompt(b.context);
  try {
    if (env.AI_MOCK === '1') return json({ provider, ...sanitise(mock(b.context, messages)) });
    if (provider === 'claude') {
      if (!env.ANTHROPIC_API_KEY) return json({ error: 'Claude isn’t set up yet: add ANTHROPIC_API_KEY in Cloudflare.' }, 409);
      return json({ provider, ...sanitise(await askClaude(env, system, messages)) });
    }
    if (!env.OPENAI_API_KEY) return json({ error: 'ChatGPT isn’t set up yet: add OPENAI_API_KEY in Cloudflare.' }, 409);
    return json({ provider, ...sanitise(await askChatGPT(env, system, messages)) });
  } catch (e) {
    return json({ error: e.message || 'The assistant had a problem' }, 502);
  }
}
