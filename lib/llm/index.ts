import { GeminiProvider } from "./gemini";
import { OpenAICompatibleProvider } from "./openai-compatible";
import type { LLMProvider } from "./types";

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
              process.env.GEMINI_MODEL || "gemini-2.5-flash",
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
