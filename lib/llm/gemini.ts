import type {
  LLMMessage,
  LLMProvider,
  LLMResponse,
  LLMTool,
} from "./types";

/**
 * Google Gemini, via the REST API.
 *
 * The default provider, because its free tier is real: Gemini 2.5 Flash
 * allows enough requests per day that a daily brief plus a handful of
 * investigations costs nothing at all. Function calling is supported, which
 * is the only feature the agent actually needs.
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
    model = "gemini-2.5-flash",
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
          parts.push({
            functionCall: { name: call.name, args: call.input },
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
        });
      }
    }

    return {
      text,
      toolCalls,
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
