import { json, googleToken } from '../../../lib/util.js';

// Short-lived token for the Google Drive file picker in the browser.
export async function onRequestGet({ env }) {
  try {
    const accessToken = await googleToken(env);
    return json({ accessToken, apiKey: env.GOOGLE_API_KEY || '', appId: env.GOOGLE_APP_ID || '' });
  } catch (e) {
    return json({ error: e.message }, 409);
  }
}
