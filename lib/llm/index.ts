import { GeminiProvider } from "./gemini";
import { OpenAICompatibleProvider } from "./openai-compatible";
import { RateLimitError } from "./types";
import type { LLMMessage, LLMProvider, LLMResponse, LLMTool } from "./types";

export * from "./types";

/**
 * Picks whichever provider is configured, cheapest-first.
 *
 * Free options come first on purpose. The project is meant to cost nothing
 * to run: a paid key is an option, never a requirement.
 */
export function getProvider(): LLMProvider {
  const forced = process.env.LLM_PROVIDER?.toLowerCase();

  const candidates: Array<{ id: string; build: () => LLMProvider | null }> = [
    {
      id: "gemini",
      build: () =>
        process.env.GEMINI_API_KEY
          ? new GeminiProvider(
              process.env.GEMINI_API_KEY,
              // Passing undefined (GEMINI_MODEL unset) still hits the
              // constructor's own default -- the model name lived in two
              // places before and drifted, which is exactly how this broke.
              process.env.GEMINI_MODEL,
            )
          : null,
    },
    {
      id: "groq",
      build: () =>
        process.env.GROQ_API_KEY
          ? new OpenAICompatibleProvider({
              id: "groq",
              baseUrl: "https://api.groq.com/openai/v1",
              apiKey: process.env.GROQ_API_KEY,
              model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
              label: `Groq ${process.env.GROQ_MODEL || "llama-3.3-70b-versatile"} (free tier)`,
              free: true,
            })
          : null,
    },
    {
      id: "ollama",
      build: () =>
        process.env.OLLAMA_BASE_URL
          ? new OpenAICompatibleProvider({
              id: "ollama",
              baseUrl: process.env.OLLAMA_BASE_URL,
              model: process.env.OLLAMA_MODEL || "llama3.1",
              label: `Ollama ${process.env.OLLAMA_MODEL || "llama3.1"} (local, free)`,
              free: true,
            })
          : null,
    },
    {
      id: "openrouter",
      build: () =>
        process.env.OPENROUTER_API_KEY
          ? new OpenAICompatibleProvider({
              id: "openrouter",
              baseUrl: "https://openrouter.ai/api/v1",
              apiKey: process.env.OPENROUTER_API_KEY,
              model:
                process.env.OPENROUTER_MODEL ||
                "meta-llama/llama-3.3-70b-instruct:free",
              label: `OpenRouter ${process.env.OPENROUTER_MODEL || "llama-3.3-70b:free"}`,
              free: (process.env.OPENROUTER_MODEL || ":free").includes(":free"),
            })
          : null,
    },
    {
      id: "anthropic",
      build: () =>
        process.env.ANTHROPIC_API_KEY
          ? new OpenAICompatibleProvider({
              id: "anthropic",
              baseUrl: "https://api.anthropic.com/v1",
              apiKey: process.env.ANTHROPIC_API_KEY,
              model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
              label: `Anthropic ${process.env.ANTHROPIC_MODEL || "claude-sonnet-5"} (paid)`,
              free: false,
            })
          : null,
    },
  ];

  if (forced) {
    const match = candidates.find((c) => c.id === forced)?.build();
    if (match) return match;
    throw new Error(
      `LLM_PROVIDER is "${forced}" but its API key is not set`,
    );
  }

  for (const c of candidates) {
    const built = c.build();
    if (built) return built;
  }

  throw new Error(
    "No model provider configured. Set one of: GEMINI_API_KEY (free), " +
      "GROQ_API_KEY (free), OLLAMA_BASE_URL (local), OPENROUTER_API_KEY, " +
      "ANTHROPIC_API_KEY.",
  );
}

/** For the UI: which provider would run, without throwing if none is set. */
export function describeProvider(): {
  configured: boolean;
  label: string;
  free: boolean;
} {
  try {
    const p = getProvider();
    return { configured: true, label: p.label, free: p.free };
  } catch {
    return { configured: false, label: "none configured", free: true };
  }
}

const MAX_RATE_LIMIT_RETRIES = 6;
// Measured against Gemini's actual free-tier quota: "5 requests per minute
// per model". A structured 429 (RateLimitError) gets the wait it actually
// asked for; this is only the fallback for a 429 that didn't say.
const FALLBACK_RETRY_MS = 15_000;
const MAX_WAIT_MS = 60_000;

/**
 * A free-tier quota is not a rare edge case for the agent loop -- it fires
 * one request per turn with nothing else throttling it, and a real
 * investigation is 8-15 turns. Measured directly against Gemini's free
 * tier: a single investigation reliably hits its request-per-minute limit
 * partway through, and the response names the exact wait required (a
 * RetryInfo detail, e.g. retryDelay: "40s") -- honored precisely here
 * rather than guessed at with backoff, which is either too short (retries
 * that fail again) or too long (wasted time on a quota that already reset).
 * Shared rather than duplicated between the investigation loop and the
 * morning brief, since both call a provider.
 */
export async function completeWithRetry(
  provider: LLMProvider,
  opts: {
    system: string;
    messages: LLMMessage[];
    tools?: LLMTool[];
    maxTokens?: number;
  },
): Promise<LLMResponse> {
  let attempt = 0;
  for (;;) {
    try {
      return await provider.complete(opts);
    } catch (err) {
      if (!(err instanceof RateLimitError) || attempt >= MAX_RATE_LIMIT_RETRIES) {
        throw err;
      }
      attempt++;
      const waitMs = Math.min(err.retryAfterMs ?? FALLBACK_RETRY_MS, MAX_WAIT_MS);
      console.warn(
        `rate limited, retrying in ${waitMs}ms (attempt ${attempt}/${MAX_RATE_LIMIT_RETRIES})`,
      );
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}
