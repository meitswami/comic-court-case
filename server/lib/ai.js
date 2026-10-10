// AI chat completions.
//
// All AI features (judge, intake chat, OCR, evidence analysis, court chat)
// call one OpenAI-compatible chat-completions endpoint. Key, URL and model are
// set by a Super Admin (Settings) or through environment variables.
//
// The provider is picked from the key when no URL is given:
//   AIza...  -> Google Gemini      (gemini-2.5-flash)
//   sk-...   -> OpenAI             (gpt-4o-mini)
//   LOVABLE_API_KEY in .env -> Lovable AI gateway (legacy setup)

import { getSetting } from './settings.js';
import { insert, generateUUID } from './mysql.js';

export class AIError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.status = status;
  }
}

const PROVIDERS = {
  gemini: {
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    model: 'gemini-2.5-flash',
  },
  openai: {
    url: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o-mini',
  },
  lovable: {
    url: 'https://ai.gateway.lovable.dev/v1/chat/completions',
    model: 'google/gemini-2.5-flash',
  },
};

async function resolveConfig() {
  let key = await getSetting('AI_API_KEY');
  let provider = null;

  if (key) {
    provider = key.startsWith('AIza') ? PROVIDERS.gemini : PROVIDERS.openai;
  } else if (process.env.LOVABLE_API_KEY) {
    key = process.env.LOVABLE_API_KEY;
    provider = PROVIDERS.lovable;
  } else if (process.env.GEMINI_API_KEY) {
    key = process.env.GEMINI_API_KEY;
    provider = PROVIDERS.gemini;
  } else if (process.env.OPENAI_API_KEY) {
    key = process.env.OPENAI_API_KEY;
    provider = PROVIDERS.openai;
  }

  if (!key) {
    throw new AIError(
      'AI is not configured yet. A Super Admin needs to add an AI API key in Admin > Settings.',
      503
    );
  }

  const url = (await getSetting('AI_API_URL')) || provider.url;
  const model = (await getSetting('AI_MODEL')) || provider.model;
  return { key, url, model };
}

export async function isAIConfigured() {
  try {
    await resolveConfig();
    return true;
  } catch (error) {
    return false;
  }
}

// messages: OpenAI-style [{ role, content }]. Returns the reply text.
// `log` = { userId, action, sessionId?, caseId? } records usage for the admin
// AI usage dashboard.
export async function chat(messages, { temperature, log } = {}) {
  const { key, url, model } = await resolveConfig();

  const body = { model, messages };
  if (typeof temperature === 'number') body.temperature = temperature;

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90000),
    });
  } catch (error) {
    throw new AIError('The AI service could not be reached. Please try again.', 502);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    console.error('[AI] Provider error:', response.status, text.slice(0, 500));
    if (response.status === 429) throw new AIError('The AI service is busy. Please try again in a moment.', 429);
    if (response.status === 401 || response.status === 403) {
      throw new AIError('The AI API key was rejected. Check it in Admin > Settings.', 503);
    }
    if (response.status === 402) throw new AIError('AI credits are exhausted.', 402);
    throw new AIError('The AI service returned an error. Please try again.', 502);
  }

  const data = await response.json();
  const content = data && data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : '';

  if (log && log.action) {
    try {
      await insert('ai_usage_logs', {
        id: generateUUID(),
        user_id: log.userId || null,
        session_id: log.sessionId || null,
        case_id: log.caseId || null,
        model_used: String(model).slice(0, 100),
        action: String(log.action).slice(0, 100),
        tokens_input: (data.usage && data.usage.prompt_tokens) || 0,
        tokens_output: (data.usage && data.usage.completion_tokens) || 0,
      });
    } catch (error) {
      console.error('[AI] Failed to log usage:', error.message);
    }
  }

  return typeof content === 'string' ? content : '';
}

// Pulls a JSON object out of a model reply (plain, or inside a ``` block).
export function extractJson(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidates = [];
  if (fenced) candidates.push(fenced[1]);
  candidates.push(text);
  const braces = text.match(/\{[\s\S]*\}/);
  if (braces) candidates.push(braces[0]);
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (error) {
      // try the next shape
    }
  }
  return null;
}
