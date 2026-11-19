import { json } from '../../lib/util.js';

// Headspace AI: Claude (ANTHROPIC_API_KEY) or ChatGPT (OPENAI_API_KEY).
// Streams the reply word by word (server-sent events). After the reply the model writes
//   @@ACTIONS@@ {"actions":[...],"chips":[...]}
// which the app turns into tappable buttons.

const VIEWS = ['today', 'tasks', 'projects', 'notes', 'journal', 'later', 'calendar', 'connections'];
const MARK = '@@ACTIONS@@';

function systemPrompt(context, assistant) {
  const persona = assistant && assistant.instructions ? `\n\nYour role for this chat ("${String(assistant.name || 'Assistant').slice(0, 60)}"):\n${String(assistant.instructions).slice(0, 4000)}` : '';
  return `You are an assistant inside Headspace, Sam's calm personal planner app. Sam is busy and wants less on his plate, not more.
Today is ${context?.today || 'unknown'} (${context?.weekday || ''}, Europe/London). Write in British English. Be warm, clear and practical. Keep answers focused; use short paragraphs and "•" bullets. Avoid markdown symbols like ** or #.${persona}

HOW TO FINISH EVERY REPLY
After your reply, on a new line, write exactly ${MARK} followed by ONE line of JSON:
{"actions":[...],"chips":[...]}
• actions: 0 to 5 buttons Sam can tap. Nothing happens until he taps. Each has "label" (max 40 chars, starts with a verb) and "type", plus fields:
  add_task {title, project?, due? "YYYY-MM-DD", priority? 1|2|3, minutes?, focus? true|false, repeat? ""|"daily"|"weekdays"|"weekly"|"monthly"}
  complete_task {id}
  focus_tasks {ids: [up to 3 task ids]}  (sets today's focus)
  add_note {title, body}  (Notebook board)
  add_idea {title, body}  (Ideas for later)
  add_project {name, emoji, blurb}
  inbox_to_task {inbox_id, title, project?, due?}
  clear_inbox_item {inbox_id}
  copy_text {text}  (copies text to the clipboard, e.g. a drafted email)
  open {view: ${VIEWS.join('|')}}
• chips: up to 4 short follow-up messages Sam might send next (max 40 chars each).
Only use ids and project names from the context below. Never claim you've done something; say what tapping will do. Always include the ${MARK} line, even if both lists are empty.

Sam's Headspace right now (JSON):
${JSON.stringify(context || {}).slice(0, 12000)}`;
}

/* Build provider-specific messages. Attachments only travel with the latest user message. */
function buildMessages(messages, attachments, provider) {
  const out = [];
  for (const m of (Array.isArray(messages) ? messages : []).slice(-24)) {
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    const content = String(m.content || '').slice(0, 30000);
    if (!content) continue;
    if (out.length && out[out.length - 1].role === role) out[out.length - 1].content += '\n\n' + content;
    else out.push({ role, content });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  if (!out.length) return out;
  const files = (Array.isArray(attachments) ? attachments : []).slice(0, 5);
  if (files.length) {
    const last = out[out.length - 1];
    const parts = [];
    for (const f of files) {
      const name = String(f.name || 'file').slice(0, 120);
      if (f.kind === 'text') parts.push({ type: 'text', text: `--- ${name} ---\n${String(f.text || '').slice(0, 120000)}` });
      else if (f.kind === 'image' && /^image\/(png|jpe?g|gif|webp)$/.test(f.mime) && f.data) {
        parts.push(provider === 'claude'
          ? { type: 'image', source: { type: 'base64', media_type: f.mime === 'image/jpg' ? 'image/jpeg' : f.mime, data: f.data } }
          : { type: 'image_url', image_url: { url: `data:${f.mime};base64,${f.data}` } });
      } else if (f.kind === 'pdf' && f.data) {
        parts.push(provider === 'claude'
          ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.data }, title: name }
          : { type: 'file', file: { filename: name, file_data: `data:application/pdf;base64,${f.data}` } });
      }
    }
    parts.push({ type: 'text', text: last.content });
    last.content = parts;
  }
  return out;
}

const sse = (obj) => `data: ${JSON.stringify(obj)}\n\n`;

/* Read an upstream SSE stream line by line */
async function* sseLines(body) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line.startsWith('data:')) yield line.slice(5).trim();
    }
  }
}

async function claudeStream(env, model, system, messages, write) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: 4000, system, messages, stream: true }),
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j.error?.message || `Claude error ${r.status}`);
  }
  const usage = { in: 0, out: 0 };
  for await (const d of sseLines(r.body)) {
    let e; try { e = JSON.parse(d); } catch { continue; }
    if (e.type === 'message_start') usage.in = e.message?.usage?.input_tokens || 0;
    else if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta') await write(sse({ t: e.delta.text }));
    else if (e.type === 'message_delta' && e.usage) usage.out = e.usage.output_tokens || usage.out;
    else if (e.type === 'error') throw new Error(e.error?.message || 'Claude stream error');
  }
  return usage;
}

async function openaiStream(env, model, system, messages, write) {
  const call = (withUsage) => fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, stream: true, ...(withUsage ? { stream_options: { include_usage: true } } : {}), messages: [{ role: 'system', content: system }, ...messages] }),
  });
  let r = await call(true);
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    if (/stream_options/i.test(j.error?.message || '')) r = await call(false);
    else throw new Error(j.error?.message || `ChatGPT error ${r.status}`);
    if (!r.ok) { const j2 = await r.json().catch(() => ({})); throw new Error(j2.error?.message || `ChatGPT error ${r.status}`); }
  }
  const usage = { in: 0, out: 0 };
  for await (const d of sseLines(r.body)) {
    if (d === '[DONE]') break;
    let e; try { e = JSON.parse(d); } catch { continue; }
    const t = e.choices?.[0]?.delta?.content;
    if (t) await write(sse({ t }));
    if (e.usage) usage.in = e.usage.prompt_tokens || 0, usage.out = e.usage.completion_tokens || 0;
  }
  return usage;
}

async function mockStream(context, messages, write) {
  const last = messages[messages.length - 1];
  const said = typeof last?.content === 'string' ? last.content : (last?.content || []).map((p) => p.text || `[${p.type}]`).join(' ');
  const t = (context?.open_tasks || [])[0];
  const text = `Test mode. You said: "${String(said).slice(0, 90)}". Here's a streamed reply so you can see words arriving one by one.`;
  for (const w of text.split(/(\s+)/)) { await write(sse({ t: w })); await new Promise((r) => setTimeout(r, 15)); }
  const tail = { actions: [
    { label: 'Add “Book stage crew” for today', type: 'add_task', title: 'Book stage crew', project: 'Madruga', due: context?.today, priority: 3 },
    ...(t ? [{ label: `Focus on “${t.title.slice(0, 24)}”`, type: 'focus_tasks', ids: [t.id] }] : []),
    { label: 'Copy a draft email', type: 'copy_text', text: 'Hi Laura, quick one about the site visit…' },
    { label: 'Open Projects', type: 'open', view: 'projects' },
  ], chips: ['Plan my day', 'What’s overdue?'] };
  await write(sse({ t: `\n${MARK} ${JSON.stringify(tail)}` }));
  return { in: 1200, out: 180 };
}

export async function onRequestPost({ request, env, waitUntil }) {
  let b;
  try { b = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
  const provider = b.provider === 'chatgpt' ? 'chatgpt' : 'claude';
  const mock = env.AI_MOCK === '1';
  if (!mock && provider === 'claude' && !env.ANTHROPIC_API_KEY) return json({ error: 'Claude isn’t set up yet: add ANTHROPIC_API_KEY in Cloudflare.' }, 409);
  if (!mock && provider === 'chatgpt' && !env.OPENAI_API_KEY) return json({ error: 'ChatGPT isn’t set up yet: add OPENAI_API_KEY in Cloudflare.' }, 409);
  const model = String(b.model || '').slice(0, 100) || (provider === 'claude' ? env.ANTHROPIC_MODEL || 'claude-sonnet-5-5' : env.OPENAI_MODEL || 'chat-latest');
  const messages = buildMessages(b.messages, b.attachments, provider);
  if (!messages.length) return json({ error: 'say something first' }, 400);
  const system = systemPrompt(b.context, b.assistant);

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const write = (s) => writer.write(enc.encode(s));

  const run = (async () => {
    try {
      await write(sse({ start: true, provider, model }));
      const usage = mock ? await mockStream(b.context, messages, write)
        : provider === 'claude' ? await claudeStream(env, model, system, messages, write)
        : await openaiStream(env, model, system, messages, write);
      await write(sse({ done: true, usage, provider, model }));
    } catch (e) {
      await write(sse({ error: e.message || 'The assistant had a problem' }));
    } finally {
      await writer.close();
    }
  })();
  if (waitUntil) waitUntil(run);

  return new Response(readable, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store', 'x-accel-buffering': 'no' } });
}
