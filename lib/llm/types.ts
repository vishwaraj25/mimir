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
