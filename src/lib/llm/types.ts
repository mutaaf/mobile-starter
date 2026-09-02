/**
 * Provider-agnostic LLM contract.
 *
 * Screens depend on this interface, never on a concrete provider, so adding a
 * fourth vendor is one new file and one registry entry.
 */

export type ProviderId = 'anthropic' | 'openai' | 'gemini';

export type LlmRequest = {
  system: string;
  user: string;
  /** Deliberately small: a briefing is a short, bounded answer. */
  maxTokens?: number;
};

export type LlmResult = {
  text: string;
  model: string;
  /** Null when the provider does not report usage. */
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
};

/** Distinguishes "your key is wrong" from "the network is down". */
export class LlmError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'rate-limit' | 'network' | 'refused' | 'server' | 'unknown',
    readonly status?: number,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

export interface LlmProvider {
  readonly id: ProviderId;
  readonly label: string;
  /** Model actually called. Surfaced in the UI so there is no mystery. */
  readonly model: string;
  /** Where the user gets a key. */
  readonly consoleUrl: string;
  /** Human hint for the expected key shape. */
  readonly keyHint: string;

  /**
   * Cheap client-side sanity check. Never a substitute for `verify` — it only
   * catches obvious paste errors before spending a request.
   */
  looksLikeKey(key: string): boolean;

  /** Minimal authenticated call, used to validate a key. */
  verify(key: string, signal?: AbortSignal): Promise<void>;

  complete(request: LlmRequest, key: string, signal?: AbortSignal): Promise<LlmResult>;
}
