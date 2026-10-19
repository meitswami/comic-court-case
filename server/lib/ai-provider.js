// Server-side AI provider client (OpenAI-compatible chat completions).
//
// Matches the provider pattern already used by the legacy Edge Functions
// (an OpenAI-compatible gateway running Gemini 2.5 Flash, or a self-hosted
// Ollama), but runs inside Express so it works on the VPS.
//
// Configuration (server environment only — never exposed to the browser):
//   AI_API_BASE_URL   e.g. https://ai.gateway.lovable.dev/v1  or  http://127.0.0.1:11434/v1
//   AI_API_KEY        bearer token (optional for local Ollama)
//   AI_MODEL          e.g. google/gemini-2.5-flash  or  llama3.1:8b
//   AI_VISION         "true" if the model accepts images (enables OCR of photos/scans)
//   AI_TIMEOUT_MS     request timeout, default 90000
// Back-compat: LOVABLE_API_KEY alone selects the existing gateway + Gemini;
// OLLAMA_ENDPOINT + OLLAMA_MODEL select a local Ollama.
//
// Remote endpoints must use HTTPS so confidential documents are never sent in
// plaintext; plain HTTP is accepted only for localhost.

import { query, generateUUID } from './mysql.js';

const LOVABLE_GATEWAY = 'https://ai.gateway.lovable.dev/v1';

export class AIProviderError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function resolveAIConfig(env = process.env) {
  let baseUrl = (env.AI_API_BASE_URL || '').trim();
  let apiKey = (env.AI_API_KEY || '').trim();
  let model = (env.AI_MODEL || '').trim();
  let vision = env.AI_VISION;

  if (!baseUrl && env.LOVABLE_API_KEY) {
    baseUrl = LOVABLE_GATEWAY;
    apiKey = apiKey || env.LOVABLE_API_KEY.trim();
    model = model || 'google/gemini-2.5-flash';
    vision = vision ?? 'true';
  }
  if (!baseUrl && env.OLLAMA_ENDPOINT) {
    baseUrl = `${env.OLLAMA_ENDPOINT.trim().replace(/\/+$/, '')}/v1`;
    model = model || (env.OLLAMA_MODEL || '').trim();
  }
  if (!apiKey && baseUrl === LOVABLE_GATEWAY && env.LOVABLE_API_KEY) apiKey = env.LOVABLE_API_KEY.trim();

  const timeoutMs = Number.parseInt(env.AI_TIMEOUT_MS || '', 10);
  const config = {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    apiKey,
    model,
    vision: String(vision ?? 'false').toLowerCase() === 'true',
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 90000,
    error: null,
  };

  if (!config.baseUrl || !config.model) {
    config.error = 'No AI provider is configured. Set AI_API_BASE_URL and AI_MODEL (and AI_API_KEY if required) on the server.';
    return config;
  }
  try {
    const url = new URL(config.baseUrl);
    const local = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
      config.error = 'AI_API_BASE_URL must use HTTPS (plain HTTP is allowed only for localhost).';
    }
    config.host = url.host;
  } catch {
    config.error = 'AI_API_BASE_URL is not a valid URL.';
  }
  return config;
}

/** Public, secret-free description of the provider for the UI. */
export function describeAIProvider() {
  const c = resolveAIConfig();
  return {
    configured: !c.error,
    reason: c.error,
    host: c.error ? null : c.host,
    model: c.error ? null : c.model,
    vision: !c.error && c.vision,
  };
}

/** Pull a JSON object out of model output (tolerates code fences / prose). */
export function parseJsonObject(content) {
  if (content && typeof content === 'object') return content;
  const text = String(content ?? '').trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
  }
  throw new AIProviderError('BAD_RESPONSE', 'The AI provider returned a response that was not valid JSON.');
}

async function logUsage({ userId, caseId, model, action, usage }) {
  try {
    await query(
      'INSERT INTO ai_usage_logs (id, user_id, case_id, model_used, action, tokens_input, tokens_output) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [generateUUID(), userId || null, caseId || null, String(model).slice(0, 100), String(action).slice(0, 100), usage?.prompt_tokens || 0, usage?.completion_tokens || 0]
    );
  } catch (error) {
    // Usage logging must never break analysis.
    console.warn('[ai-provider] usage log failed:', error.message);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Send a chat request and return the parsed JSON object.
 * @param {{system: string, user: string, images?: Array<{mime: string, base64: string}>,
 *          maxTokens?: number, action: string, userId?: string, caseId?: string}} req
 */
export async function chatJSON(req) {
  const config = resolveAIConfig();
  if (config.error) throw new AIProviderError('NOT_CONFIGURED', config.error, 503);
  if (req.images?.length && !config.vision) {
    throw new AIProviderError('NO_VISION', 'The configured AI model does not accept images, so scanned pages cannot be read.', 422);
  }

  const userContent = req.images?.length
    ? [
        { type: 'text', text: req.user },
        ...req.images.map((img) => ({ type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.base64}` } })),
      ]
    : req.user;

  const body = {
    model: config.model,
    temperature: 0,
    max_tokens: req.maxTokens || 4096,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: req.system },
      { role: 'user', content: userContent },
    ],
  };

  for (let attempt = 0; ; attempt++) {
    try {
      const data = await requestOnce(config, body);
      const content = data?.choices?.[0]?.message?.content;
      if (!content) throw new AIProviderError('BAD_RESPONSE', 'The AI provider returned an empty response.', 502);
      await logUsage({ userId: req.userId, caseId: req.caseId, model: config.model, action: req.action, usage: data.usage });
      return parseJsonObject(content);
    } catch (error) {
      if (!error.retryable || attempt >= 1) throw error;
      await sleep(1500);
    }
  }
}

async function requestOnce(config, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  let res;
  try {
    res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    const e = error.name === 'AbortError'
      ? new AIProviderError('TIMEOUT', 'The AI provider did not respond in time.', 504)
      : new AIProviderError('NETWORK', 'Could not reach the AI provider.', 502);
    e.retryable = true;
    throw e;
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 429 || res.status >= 500) {
    const e = res.status === 429
      ? new AIProviderError('RATE_LIMITED', 'The AI provider is rate limiting requests. Try again shortly.', 502)
      : new AIProviderError('PROVIDER_ERROR', `The AI provider returned an error (${res.status}).`, 502);
    e.retryable = true;
    throw e;
  }
  if (!res.ok) {
    // Provider error bodies are not echoed: they can contain request content.
    throw new AIProviderError('PROVIDER_ERROR', `The AI provider rejected the request (${res.status}).`, 502);
  }
  try {
    return await res.json();
  } catch {
    throw new AIProviderError('BAD_RESPONSE', 'The AI provider returned a response that was not JSON.', 502);
  }
}
