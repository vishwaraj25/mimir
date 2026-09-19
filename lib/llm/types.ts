/**
 * A provider-neutral tool-calling interface.
 *
 * The agent loop in lib/agent/runner.ts is written against this, not against
 * any vendor SDK, so the same investigation runs on a free Gemini key, a free
 * Groq key, a local Ollama model, or a paid Anthropic key -- swapped by an
 * environment variable, with no change to the agent.
 *
 * That portability is the point: this project should cost nothing to run.
 */

export interface LLMTool {
  name: string;
  description: string;
  /** JSON Schema for the tool's arguments. */
  parameters: Record<string, unknown>;
}

export interface LLMToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  /**
   * Opaque per-provider state that has to round-trip through conversation
   * history for that SAME provider to keep working, but that no other
   * provider or the agent loop should ever need to read. Gemini's thinking
   * models use this for `thoughtSignature`: they reject a later turn if a
   * function-call part from their own prior response comes back without it.
   * Providers that don't need this just never set or read it.
   */
  raw?: unknown;
}

export interface LLMToolResult {
  id: string;
  name: string;
  /** Serialised result handed back to the model. */
  content: string;
  isError?: boolean;
}

/** One turn of the conversation, in the neutral shape. */
export type LLMMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; toolCalls: LLMToolCall[] }
  | { role: "tool_results"; results: LLMToolResult[] };

export interface LLMResponse {
  text: string;
  toolCalls: LLMToolCall[];
  usage?: { inputTokens: number; outputTokens: number };
}

/**
 * Thrown instead of a plain Error when a provider's response was
 * identifiably a rate limit, so the retry logic doesn't have to guess from
 * a status code buried in a message string. `retryAfterMs`, when the
 * provider tells you exactly how long to wait (Gemini does, in its
 * response body), is honored precisely instead of guessed at with backoff.
 */
export class RateLimitError extends Error {
  constructor(
    message: string,
    public retryAfterMs?: number,
  ) {
    super(message);
    this.name = "RateLimitError";
  }
}

export interface LLMProvider {
  /** e.g. "gemini", "groq", "anthropic", "ollama" */
  readonly id: string;
  readonly model: string;
  /** Shown in the UI so you always know what actually ran. */
  readonly label: string;
  /** Whether this provider costs money, so the UI can say so honestly. */
  readonly free: boolean;

  complete(opts: {
    system: string;
    messages: LLMMessage[];
    tools?: LLMTool[];
    maxTokens?: number;
  }): Promise<LLMResponse>;
}
