import { RateLimitError } from "./types";
import type {
  LLMMessage,
  LLMProvider,
  LLMResponse,
  LLMTool,
} from "./types";

/**
 * Anything that speaks the OpenAI chat-completions API.
 *
 * One implementation covers a lot of free ground:
 *   Groq       free tier, very fast, llama-3.3-70b-versatile
 *   OpenRouter has genuinely free model variants
 *   Ollama     local, free forever, no API key, no network
 *   LM Studio  same
 *
 * Useful beyond cost: pointing this at Ollama means the agent can run with
 * no third party seeing the telemetry it reasons over at all.
 */
export class OpenAICompatibleProvider implements LLMProvider {
  readonly id: string;
  readonly model: string;
  readonly label: string;
  readonly free: boolean;

  constructor(
    private opts: {
      id: string;
      baseUrl: string;
      apiKey?: string;
      model: string;
      label: string;
      free: boolean;
    },
  ) {
    this.id = opts.id;
    this.model = opts.model;
    this.label = opts.label;
    this.free = opts.free;
  }

  async complete(opts: {
    system: string;
    messages: LLMMessage[];
    tools?: LLMTool[];
    maxTokens?: number;
  }): Promise<LLMResponse> {
    const messages: Record<string, unknown>[] = [
      { role: "system", content: opts.system },
    ];

    for (const m of opts.messages) {
      if (m.role === "user") {
        messages.push({ role: "user", content: m.text });
      } else if (m.role === "assistant") {
        messages.push({
          role: "assistant",
          content: m.text || null,
          ...(m.toolCalls.length
            ? {
                tool_calls: m.toolCalls.map((c) => ({
                  id: c.id,
                  type: "function",
                  function: {
                    name: c.name,
                    arguments: JSON.stringify(c.input),
                  },
                })),
              }
            : {}),
        });
      } else {
        for (const r of m.results) {
          messages.push({
            role: "tool",
            tool_call_id: r.id,
            content: r.content,
          });
        }
      }
    }

    const body: Record<string, unknown> = {
      model: this.opts.model,
      messages,
      max_tokens: opts.maxTokens ?? 4096,
      temperature: 0.2,
      // gpt-oss models spend output tokens on hidden reasoning before the
      // visible answer; "low" keeps that from eating the reply budget on a
      // free tier that counts every token against a per-minute ceiling.
      ...(this.opts.model.includes("gpt-oss") ? { reasoning_effort: "low" } : {}),
    };

    if (opts.tools?.length) {
      body.tools = opts.tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.opts.apiKey) {
      headers.Authorization = `Bearer ${this.opts.apiKey}`;
    }

    const res = await fetch(`${this.opts.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const detail = await res.text();
      if (res.status === 429) {
        // The OpenAI-compatible convention is a Retry-After header (seconds
        // or an HTTP date); honor it when present instead of guessing.
        const header = res.headers.get("retry-after");
        const seconds = header ? Number(header) : NaN;
        const retryAfterMs = Number.isFinite(seconds) ? seconds * 1000 : undefined;
        throw new RateLimitError(
          `${this.id} 429: ${detail.slice(0, 400)}`,
          retryAfterMs,
        );
      }
      throw new Error(`${this.id} ${res.status}: ${detail.slice(0, 400)}`);
    }

    const data = await res.json();
    const choice = data.choices?.[0]?.message ?? {};

    const toolCalls = (choice.tool_calls ?? []).map((c: any) => {
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(c.function?.arguments || "{}");
      } catch {
        // A model that emits malformed arguments should surface as a tool
        // error the agent can react to, not crash the whole investigation.
        input = { __parse_error: c.function?.arguments };
      }
      return { id: c.id, name: c.function?.name, input };
    });

    return {
      text: choice.content ?? "",
      finishReason: data.choices?.[0]?.finish_reason,
      toolCalls,
      usage: data.usage
        ? {
            inputTokens: data.usage.prompt_tokens ?? 0,
            outputTokens: data.usage.completion_tokens ?? 0,
          }
        : undefined,
    };
  }
}
