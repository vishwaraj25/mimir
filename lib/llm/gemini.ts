import { RateLimitError } from "./types";
import type {
  LLMMessage,
  LLMProvider,
  LLMResponse,
  LLMTool,
} from "./types";

/**
 * Google Gemini, via the REST API.
 *
 * The default provider, because its free tier is real: Gemini's Flash tier
 * allows enough requests per day that a daily brief plus a handful of
 * investigations costs nothing at all. Function calling is supported, which
 * is the only feature the agent actually needs.
 *
 * The current default model (gemini-3.6-flash) is a thinking model -- it
 * returns a `thoughtSignature` on parts and requires it echoed back on any
 * functionCall part sent as history, or it rejects the next turn outright.
 * See the `raw` field on LLMToolCall for how that round-trips without
 * leaking into the neutral interface.
 *
 * Called over fetch rather than through the SDK to keep the dependency
 * surface small -- the request shape here is stable and short.
 */
export class GeminiProvider implements LLMProvider {
  readonly id = "gemini";
  readonly free = true;
  readonly model: string;
  readonly label: string;

  constructor(
    private apiKey: string,
    model = "gemini-3.6-flash",
  ) {
    this.model = model;
    this.label = `Google ${model} (free tier)`;
  }

  async complete(opts: {
    system: string;
    messages: LLMMessage[];
    tools?: LLMTool[];
    maxTokens?: number;
  }): Promise<LLMResponse> {
    const contents = opts.messages.map((m) => {
      if (m.role === "user") {
        return { role: "user", parts: [{ text: m.text }] };
      }
      if (m.role === "assistant") {
        const parts: Record<string, unknown>[] = [];
        if (m.text) parts.push({ text: m.text });
        for (const call of m.toolCalls) {
          const thoughtSignature = (call.raw as { thoughtSignature?: string } | undefined)
            ?.thoughtSignature;
          parts.push({
            functionCall: { name: call.name, args: call.input },
            // Gemini's thinking models reject a later turn outright if a
            // functionCall part from their OWN prior response comes back
            // without the signature they attached to it -- so it has to
            // survive the round trip through the neutral message history.
            ...(thoughtSignature ? { thoughtSignature } : {}),
          });
        }
        return { role: "model", parts };
      }
      return {
        role: "user",
        parts: m.results.map((r) => ({
          functionResponse: {
            name: r.name,
            // Gemini wants an object here, not a bare string.
            response: { result: r.content },
          },
        })),
      };
    });

    const body: Record<string, unknown> = {
      system_instruction: { parts: [{ text: opts.system }] },
      contents,
      generationConfig: {
        maxOutputTokens: opts.maxTokens ?? 4096,
        temperature: 0.2,
      },
    };

    if (opts.tools?.length) {
      body.tools = [
        {
          functionDeclarations: opts.tools.map((t) => ({
            name: t.name,
            description: t.description,
            // Gemini rejects an empty properties object, so omit parameters
            // entirely for no-argument tools.
            ...(Object.keys(
              (t.parameters.properties as object) ?? {},
            ).length > 0
              ? { parameters: stripUnsupported(t.parameters) }
              : {}),
          })),
        },
      ];
    }

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": this.apiKey,
        },
        body: JSON.stringify(body),
      },
    );

    if (!res.ok) {
      const detail = await res.text();
      if (res.status === 429) {
        // Free-tier quota is exactly "N requests per minute per model", and
        // Gemini's error body names the wait precisely (a RetryInfo detail
        // with e.g. retryDelay: "40s") -- honor that instead of guessing.
        let retryAfterMs: number | undefined;
        try {
          const parsed = JSON.parse(detail);
          const retryInfo = parsed?.error?.details?.find(
            (d: any) => d["@type"]?.includes("RetryInfo"),
          );
          const seconds = retryInfo?.retryDelay?.match(/^(\d+(?:\.\d+)?)s$/)?.[1];
          if (seconds) retryAfterMs = Math.ceil(parseFloat(seconds) * 1000);
        } catch {
          // Body wasn't the JSON shape we expected -- fall through with no
          // explicit delay, and let the caller's own backoff handle it.
        }
        throw new RateLimitError(
          `Gemini 429: ${detail.slice(0, 400)}`,
          retryAfterMs,
        );
      }
      throw new Error(`Gemini ${res.status}: ${detail.slice(0, 400)}`);
    }

    const data = await res.json();
    const parts = data.candidates?.[0]?.content?.parts ?? [];

    let text = "";
    const toolCalls = [];
    let i = 0;
    for (const part of parts) {
      if (part.text) text += part.text;
      if (part.functionCall) {
        toolCalls.push({
          id: `${part.functionCall.name}-${i++}`,
          name: part.functionCall.name,
          input: (part.functionCall.args ?? {}) as Record<string, unknown>,
          raw: part.thoughtSignature
            ? { thoughtSignature: part.thoughtSignature }
            : undefined,
        });
      }
    }

    return {
      text,
      toolCalls,
      finishReason: data.candidates?.[0]?.finishReason,
      usage: data.usageMetadata
        ? {
            inputTokens: data.usageMetadata.promptTokenCount ?? 0,
            outputTokens: data.usageMetadata.candidatesTokenCount ?? 0,
          }
        : undefined,
    };
  }
}

/**
 * Gemini's schema dialect is a subset of JSON Schema and errors on keys it
 * does not know, so unsupported ones are dropped rather than passed through.
 */
function stripUnsupported(schema: Record<string, unknown>): unknown {
  const allowed = new Set([
    "type",
    "description",
    "properties",
    "required",
    "items",
    "enum",
  ]);
  const walk = (node: any): any => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node)) {
        if (!allowed.has(k)) continue;
        out[k] = k === "properties" ? mapValues(v as any, walk) : walk(v);
      }
      return out;
    }
    return node;
  };
  return walk(schema);
}

function mapValues(obj: Record<string, unknown>, fn: (v: unknown) => unknown) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) out[k] = fn(v);
  return out;
}
