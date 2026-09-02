import { LlmError, type LlmProvider, type ProviderId } from './types';

/**
 * Three providers behind one interface, all over plain `fetch`.
 *
 * Raw HTTP rather than each vendor's SDK: this is a mobile bundle, the three
 * SDKs together dwarf the code below, and they target server/browser runtimes.
 * One transport also means one place to normalise errors and usage reporting.
 */

const TIMEOUT_MS = 45_000;

function composeSignal(signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/** Maps any provider's HTTP status onto one vocabulary the UI can act on. */
function classify(status: number, body: string): LlmError {
  if (status === 401 || status === 403) {
    return new LlmError('Key rejected. Check it was pasted in full.', 'auth', status);
  }
  if (status === 429) {
    return new LlmError('Rate limited or out of credit.', 'rate-limit', status);
  }
  if (status >= 500) {
    return new LlmError('Provider is having trouble. Try again.', 'server', status);
  }
  // Trim: provider error bodies can be enormous and may echo the request.
  return new LlmError(`Request rejected (${status}): ${body.slice(0, 160)}`, 'unknown', status);
}

async function postJson(
  url: string,
  init: { headers: Record<string, string>; body: unknown },
  signal?: AbortSignal,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...init.headers },
      body: JSON.stringify(init.body),
      signal: composeSignal(signal),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new LlmError('Could not reach the provider.', 'network');
  }

  if (!response.ok) {
    throw classify(response.status, await response.text().catch(() => ''));
  }
  return response.json();
}

// ------------------------------------------------------------------ anthropic

type AnthropicResponse = {
  model: string;
  stop_reason: string;
  content: { type: string; text?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number };
};

const anthropic: LlmProvider = {
  id: 'anthropic',
  label: 'Anthropic',
  model: 'claude-opus-5',
  consoleUrl: 'https://console.anthropic.com/settings/keys',
  keyHint: 'starts with sk-ant-',

  looksLikeKey: (key) => /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key.trim()),

  async verify(key, signal) {
    // One token is the cheapest possible authenticated call.
    await this.complete({ system: 'Reply with OK.', user: 'OK', maxTokens: 1 }, key, signal);
  },

  async complete(request, key, signal) {
    const started = Date.now();
    const json = (await postJson(
      'https://api.anthropic.com/v1/messages',
      {
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
        body: {
          model: this.model,
          max_tokens: request.maxTokens ?? 1500,
          system: request.system,
          messages: [{ role: 'user', content: request.user }],
          // Opus 5 thinks adaptively by default; a short briefing does not need
          // deep reasoning, and low effort keeps mobile latency sane.
          output_config: { effort: 'low' },
        },
      },
      signal,
    )) as AnthropicResponse;

    // A refusal is HTTP 200 — check stop_reason before reading content.
    if (json.stop_reason === 'refusal') {
      throw new LlmError('The model declined this request.', 'refused');
    }

    return {
      text: json.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('')
        .trim(),
      model: json.model,
      inputTokens: json.usage?.input_tokens ?? null,
      outputTokens: json.usage?.output_tokens ?? null,
      latencyMs: Date.now() - started,
    };
  },
};

// --------------------------------------------------------------------- openai

type OpenAiResponse = {
  model: string;
  choices: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

const openai: LlmProvider = {
  id: 'openai',
  label: 'OpenAI',
  model: 'gpt-4o-mini',
  consoleUrl: 'https://platform.openai.com/api-keys',
  keyHint: 'starts with sk-',

  looksLikeKey: (key) => /^sk-[A-Za-z0-9_-]{20,}$/.test(key.trim()),

  async verify(key, signal) {
    await this.complete({ system: 'Reply with OK.', user: 'OK', maxTokens: 1 }, key, signal);
  },

  async complete(request, key, signal) {
    const started = Date.now();
    const json = (await postJson(
      'https://api.openai.com/v1/chat/completions',
      {
        headers: { authorization: `Bearer ${key}` },
        body: {
          model: this.model,
          max_tokens: request.maxTokens ?? 1500,
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.user },
          ],
        },
      },
      signal,
    )) as OpenAiResponse;

    return {
      text: (json.choices[0]?.message?.content ?? '').trim(),
      model: json.model,
      inputTokens: json.usage?.prompt_tokens ?? null,
      outputTokens: json.usage?.completion_tokens ?? null,
      latencyMs: Date.now() - started,
    };
  },
};

// --------------------------------------------------------------------- gemini

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
};

const gemini: LlmProvider = {
  id: 'gemini',
  label: 'Google Gemini',
  model: 'gemini-2.0-flash',
  consoleUrl: 'https://aistudio.google.com/apikey',
  keyHint: 'starts with AIza',

  looksLikeKey: (key) => /^AIza[A-Za-z0-9_-]{30,}$/.test(key.trim()),

  async verify(key, signal) {
    await this.complete({ system: 'Reply with OK.', user: 'OK', maxTokens: 1 }, key, signal);
  },

  async complete(request, key, signal) {
    const started = Date.now();
    // The key goes in a header, not the query string: URLs leak into logs and
    // crash reports far more readily than headers do.
    const json = (await postJson(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`,
      {
        headers: { 'x-goog-api-key': key },
        body: {
          systemInstruction: { parts: [{ text: request.system }] },
          contents: [{ role: 'user', parts: [{ text: request.user }] }],
          generationConfig: { maxOutputTokens: request.maxTokens ?? 1500 },
        },
      },
      signal,
    )) as GeminiResponse;

    return {
      text: (json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '').trim(),
      model: this.model,
      inputTokens: json.usageMetadata?.promptTokenCount ?? null,
      outputTokens: json.usageMetadata?.candidatesTokenCount ?? null,
      latencyMs: Date.now() - started,
    };
  },
};

export const PROVIDERS: Record<ProviderId, LlmProvider> = { anthropic, openai, gemini };
export const PROVIDER_LIST: LlmProvider[] = [anthropic, openai, gemini];
