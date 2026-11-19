import { json } from '../../lib/util.js';

// Lists the models your API keys can use, straight from Anthropic and OpenAI.
const SKIP = /audio|realtime|transcribe|tts|image|embedding|search|moderation|whisper|dall|davinci|babbage|instruct|codex|computer/i;

export async function onRequestGet({ env }) {
  const out = { claude: [], chatgpt: [], defaults: { claude: env.ANTHROPIC_MODEL || 'claude-sonnet-5-5', chatgpt: env.OPENAI_MODEL || 'chat-latest' } };
  if (env.AI_MOCK === '1') {
    out.claude = [{ id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' }, { id: 'claude-opus-5-5', name: 'Claude Opus 5.5' }, { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5' }];
    out.chatgpt = [{ id: 'chat-latest', name: 'chat-latest' }];
    return json(out);
  }
  const jobs = [];
  if (env.ANTHROPIC_API_KEY) {
    jobs.push(fetch('https://api.anthropic.com/v1/models?limit=100', { headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' } })
      .then((r) => r.json())
      .then((j) => { out.claude = (j.data || []).map((m) => ({ id: m.id, name: m.display_name || m.id })); })
      .catch(() => {}));
  }
  if (env.OPENAI_API_KEY) {
    jobs.push(fetch('https://api.openai.com/v1/models', { headers: { authorization: `Bearer ${env.OPENAI_API_KEY}` } })
      .then((r) => r.json())
      .then((j) => {
        out.chatgpt = (j.data || [])
          .map((m) => m.id)
          .filter((id) => /^(gpt|o\d|chat-latest|chatgpt)/.test(id) && !SKIP.test(id))
          .sort()
          .reverse()
          .map((id) => ({ id, name: id }));
      })
      .catch(() => {}));
  }
  await Promise.all(jobs);
  return json(out);
}
